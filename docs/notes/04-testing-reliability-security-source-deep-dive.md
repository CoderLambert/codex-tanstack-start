# Agent Runtime 测试、可靠性与安全：源码驱动的生产级深挖

> 基线：`main@294ecae6`
>
> 本文从本仓库真实 Runtime、workspace、error、stream、reducer 与 storage 实现出发，建立一套可迁移的 Agent 工程可靠性方法。统一模板：**源码位置 → 风险模型 → 原理 → 当前实现 → 失败场景 → 工业级范式 → 验证方法**。

---

## 1. 为什么 Agent 系统不能用“接口返回 200”证明可靠

完整链路：

```text
Browser
  ↓
TanStack Start RPC
  ↓
Streaming Bridge
  ↓
Codex Runtime Adapter
  ↓
child process
  ↓
stdio protocol
  ↓
thread / turn / item lifecycle
  ↓
application event
  ↓
React state machine
  ↓
local persistence
```

每层都可能单独成功或失败。

例如：

```text
HTTP/RPC 成功
但 child process 卡死

Runtime 产出 delta
但 normalizer 丢事件

UI 正常显示
但旧 stream 污染新会话

read-only sandbox 正常
但 workspace path 可越界
```

因此可靠性是**端到端组合属性**，不是某个函数的返回值。

---

## 2. 先建立 Failure Domain，而不是先写测试数量目标

当前系统至少有这些 failure domain：

```text
Input Validation
Workspace Resolution
Runtime Startup
Authentication
Protocol Handshake
Request Correlation
Notification Parsing
Turn Lifecycle
Cancellation
Process Cleanup
Event Normalization
Client State Transition
Persistence
UI Rendering
```

测试计划应该从 failure domain 推导，而不是从文件数推导。

错误思路：

```text
“每个文件写两个测试”
```

正确思路：

```text
“每一种重要失败方式，都有一层测试能够证明它被正确处理”
```

---

## 3. 测试金字塔：不同层证明不同事实

推荐：

```text
                   E2E
              ─────────────
             Protocol Smoke
          ───────────────────
        Integration / Fake Process
     ─────────────────────────────
              Unit Tests
```

### Unit

适合：

- `normalizeThreadId`
- workspace confinement
- error classification
- provider item mapping
- ChatEvent normalization
- reducer transitions
- localStorage parsing

证明：

```text
局部纯逻辑正确
```

不能证明：

```text
真实 child process 没竞态
真实 Codex 协议仍兼容
浏览器到 Runtime 全链路工作
```

### Integration

适合：

```text
AppServerConnection + fake child process + scripted protocol
```

证明：

- request id 匹配；
- notification 不丢；
- server request 被处理；
- child 提前退出能传播错误；
- abort 后资源释放；
- turn complete 后 generator 收敛。

### Protocol Smoke

真实启动 Codex App Server，验证最小真实序列：

```text
initialize
initialized
thread/start
turn/start
item/started(agentMessage)
item/agentMessage/delta × N
item/completed(agentMessage)
turn/completed
```

它不是为了覆盖分支，而是发现：

```text
CLI 升级
协议变化
登录失效
模型不可用
环境差异
```

### E2E

验证用户语义：

```text
发送
→ running
→ 流式增长
→ completed
→ 刷新恢复
→ New Chat
→ 旧流不能污染新会话
```

---

## 4. Workspace Confinement：路径安全不是字符串 `startsWith`

真实源码：

```ts
canonicalRoot = await realpath(root)
canonicalCandidate = await realpath(candidate)
const child = relative(root, candidate)
return child === '' || (!child.startsWith('..') && !isAbsolute(child))
```

### 为什么要 `realpath`

字符串路径可能包含：

```text
../
./
symlink
不同规范化形式
```

仅判断：

```ts
candidate.startsWith(root)
```

会有典型漏洞：

```text
root = /repo/app
candidate = /repo/application-secret
```

字符串前缀成立，但它不是 root 的子目录。

更严重的是 symlink：

```text
/repo/app/link -> /etc
```

不 canonicalize 就可能从允许目录逃逸。

### 工业级路径验证

```text
1. resolve input
2. realpath root
3. realpath candidate
4. relative(root, candidate)
5. reject .. or absolute escape
6. verify resource type
```

这就是当前 `workspace.server.ts` 值得学习的地方。

---

## 5. V0 Read-only：安全不是一个 sandbox 参数

当前 Runtime：

```text
approvalPolicy: never
sandbox: read-only
sandboxPolicy.networkAccess: false
```

Server Request：

```text
统一拒绝 interactive request
```

Workspace：

```text
限制在 allowed root
```

Transport：

```text
只暴露 ChatEvent 白名单
```

Error：

```text
详细错误 server log
通用错误 browser
```

所以真正的 V0 安全模型是：

```text
Execution capability restriction
+ Workspace confinement
+ No privilege escalation path
+ Data minimization
+ Error sanitization
```

### 关键原则

> Read-only execution 和 read-only information exposure 不是同一件事。

即使 Agent 无法写文件，它仍可能读取敏感数据并把内容返回 Browser。

因此 workspace root 和 event filtering 同样重要。

---

## 6. Allow-list Mapping：为什么安全边界应该“默认丢字段”

`mapAppServerItem()` 对 MCP：

```ts
arguments: undefined,
result: undefined,
error: undefined,
```

### 错误范式

```ts
return {
  ...rawProviderItem,
  type: normalize(rawProviderItem.type),
}
```

外部协议以后新增：

```text
credentials
internalPath
rawResponse
```

这些字段可能自动穿透。

### 正确范式

```ts
return {
  id,
  type,
  safeFieldA,
  safeFieldB,
}
```

新增 Provider 字段默认被忽略，只有经过审查才进入应用层。

这叫 **secure by construction**，而不是事后 blacklist。

---

## 7. Error Taxonomy：错误必须支持“恢复决策”

源码定义：

```text
INVALID_INPUT
INVALID_WORKSPACE
AUTH_REQUIRED
RUNTIME_START_FAILED
CODEX_RUNTIME_FAILED
```

### 为什么分类比 message 更重要

产品真正需要知道：

```text
是否可重试？
是否提示登录？
是否提示用户改路径？
是否需要报警？
是否应该降级？
```

例如：

```text
AUTH_REQUIRED -> 引导服务器登录
INVALID_WORKSPACE -> 用户/配置错误，不自动重试
RUNTIME_START_FAILED -> 检查可执行文件与宿主机环境
CODEX_RUNTIME_FAILED -> 记录诊断，可能有限重试
```

### 生产范式

错误模型至少包含：

```ts
{
  code,
  safeMessage,
  retryable,
  cause,
  correlationId,
}
```

`cause` 只在 server observability 内部使用，不直接序列化给 Browser。

---

## 8. 字符串错误分类：V0 可用，但要知道边界

当前 `normalizeCodexRuntimeError()` 会检测：

```text
authentication
unauthorized
401
spawn
ENOENT
permission denied
```

### 风险

错误文本是非稳定协议：

- 版本升级会改文案；
- locale 可能改变；
- 同一个关键字可能误判；
- nested error 信息可能丢失。

### 升级顺序

优先使用：

```text
typed protocol error
structured code
exit code
known error class
最后才是 message heuristic
```

但在没有结构化错误的 V0，字符串 fallback 仍有现实价值。

正确做法是把它标记为兼容层，而不是把它当稳定领域规则。

---

## 9. Timeout：当前架构最重要的可靠性补强之一

Agent Runtime 有很多可能无限等待的位置：

```text
spawn 后没响应
initialize 没 response
thread/resume 卡住
turn/start 卡住
长时间没有 notification
close 等不到 exit
```

没有 timeout，系统可能出现：

```text
UI 永久 running
server request 永久占用
child process 泄漏
```

### 不能只设置一个“200 秒总超时”

不同阶段语义不同：

```text
startup timeout        例如很短
RPC request timeout    中等
turn idle timeout      基于是否持续有事件
turn total timeout     产品策略
close timeout          很短 + force kill
```

### 工业级范式

每个 timeout 都要定义：

```text
开始计时点
什么事件会刷新计时
触发后的取消动作
用户看到什么错误
是否 retryable
metric 名称
```

---

## 10. Cancellation：从逻辑取消走向物理资源取消

当前 Browser 有 generation guard：

```text
旧 generation event 不 dispatch
```

Runtime 有 `AbortSignal`：

```text
abort -> connection.close()
```

### 两层意义不同

```text
Generation Guard
= 不接受旧结果

AbortSignal
= 停止底层工作
```

生产取消链路应该闭合：

```text
Stop Button
  ↓
AbortController.abort()
  ↓ RPC cancellation
Server turn context
  ↓
Runtime interrupt / close
  ↓
child process / provider
```

同时 UI 仍保留 generation/token guard，防止取消竞态中迟到事件写入状态。

这叫：

```text
physical cancellation + logical stale-result protection
```

---

## 11. Race Condition：最常见的是“生命周期交叉”而不是线程锁

典型竞态：

### Case A：New Chat 与旧 Turn

```text
Turn A running
New Chat
Turn A delta arrives
```

需要 generation guard。

### Case B：Abort 与 Complete 同时发生

```text
user abort
turn/completed already in pipe
```

需要定义最终状态优先级，确保 reducer 幂等。

### Case C：Thread resume 失败后错误创建新 thread

如果 fallback 策略不明确，可能出现 UI 认为继续旧会话、Runtime 实际新建会话。

### Case D：Storage restore 与首次 persist

如果还未 restore 就先 persist initial empty state，可能覆盖已有历史。

当前 `restored` flag 正是为避免这个竞态：

```text
restore finished
   ↓
允许 persistence effect
```

---

## 12. Idempotency：事件驱动 UI 必须考虑重复事件

网络和流式系统应该默认考虑：

```text
事件可能重复
事件可能迟到
事件可能部分丢失
```

当前 `assistant.started`：

```ts
if (state.messages.some(message => message.id === event.id)) {
  return state
}
```

这是一种幂等处理。

`assistant.completed` 使用 upsert，也具有一定 reconciliation 能力。

### 工业级原则

对每类事件问：

```text
重复两次会怎样？
乱序会怎样？
漏掉 started 直接收到 delta 会怎样？
completed 重放会怎样？
```

这比只测试 happy path 更接近生产。

---

## 13. Final Snapshot Reconciliation：可靠性优先于“纯粹的 delta 拼接”

实时：

```text
assistant.delta -> append
```

最终：

```text
assistant.completed -> replace final text
```

### 为什么这是可靠性设计

如果某个 delta 丢失：

```text
partial UI
  ↓ completed
correct final text
```

如果 delta 重复：

```text
duplicated temporary UI
  ↓ completed
correct final text
```

因此 completed snapshot 是 authoritative convergence point。

工业系统里非常值得复用：

```text
incremental projection
+
final authoritative state
```

---

## 14. Child Process Lifecycle：测试必须覆盖异常退出

`nextMessage()` 在 stdout 结束时：

```ts
if (next.done) {
  throw new Error(...stderr...)
}
```

这避免 generator 永久等待。

但测试应覆盖至少：

```text
child start failed
child exits before initialize
child exits during turn
stdout closes with stderr
stdout closes without stderr
invalid JSON line
stdin destroyed before request
close called twice
abort during request
```

### 资源测试不是“实现细节测试”

Agent Runtime 长期运行时，泄漏的是：

- process；
- fd；
- event listener；
- pending promise；
- memory buffer。

这些最终都会变成生产事故。

---

## 15. Observability：日志必须按 Turn 关联，而不是打印随机字符串

推荐每次 turn 生成/携带：

```text
requestId
threadId
turnId
runtimeInstanceId
workspaceId/path-hash
```

日志事件使用结构化字段：

```text
runtime.spawn.started
runtime.initialized
thread.resumed
turn.started
assistant.first_delta
turn.completed
runtime.closed
```

并记录关键 latency：

```text
T_startup
T_initialize
T_thread_ready
TTFT = first token latency
T_turn_total
T_close
```

### 为什么不能把 prompt 全量打日志

Prompt、tool result、路径都可能含敏感信息。

Observability 自己也是 data exposure boundary。

使用：

```text
长度
hash
类型
ID
耗时
状态
```

代替默认全量正文。

---

## 16. Metrics：真正能告诉你架构是否需要升级的数据

建议：

```text
turn_success_total
turn_failure_total{code}
turn_cancel_total
runtime_spawn_failure_total
runtime_forced_kill_total
thread_resume_failure_total
invalid_protocol_message_total
first_delta_latency_ms
turn_duration_ms
active_runtime_processes
```

没有指标时，很容易凭感觉提前引入 Runtime Supervisor、队列或复杂缓存。

### 架构升级应由证据驱动

例如 process-per-turn 是否要改成长连接，至少应知道：

```text
spawn + initialize 占总延迟多少？
进程失败率多少？
并发数多少？
资源峰值多少？
```

---

## 17. Retry：Agent Turn 不能像 GET 请求一样随便重试

危险场景：

```text
请求超时
客户端自动重试
原 turn 实际仍在执行
```

如果未来允许写操作，就可能造成：

```text
重复改文件
重复发消息
重复调用工具
```

### 生产范式

先区分：

```text
安全重试阶段：initialize / read-only metadata
危险重试阶段：turn 已开始并可能产生 side effect
```

写能力开放后需要：

- turn idempotency key；
- operation IDs；
- tool-side deduplication；
- 明确 retry policy。

不能用通用 HTTP retry 中间件无脑包住 Agent turn。

---

## 18. 安全演进：从 read-only 到 writable 时必须增加什么

不能只改：

```text
sandbox: read-only -> writable
```

至少需要：

```text
Capability model
Approval policy
Workspace write scope
Command allow/deny policy
Network policy
Tool permission model
Audit trail
Diff preview
User confirmation semantics
Rollback/recovery
```

### 推荐能力模型

```text
read_workspace
write_workspace
execute_command
network_access
mcp_tool:<name>
external_side_effect
```

每个 Runtime/Tool 声明需要哪些 capability，由 server policy 决定是否授予。

---

## 19. Security Review Checklist

### Input

- [ ] 所有 RPC 输入运行时校验。
- [ ] threadId normalize。
- [ ] prompt 长度限制。
- [ ] workspace canonicalization。

### Execution

- [ ] sandbox policy server-owned。
- [ ] network 默认关闭。
- [ ] approval 默认 deny。
- [ ] Abort 能释放底层资源。

### Output

- [ ] Provider object allow-list mapping。
- [ ] Tool args/result 默认不出 Browser。
- [ ] Error sanitization。
- [ ] Log 不默认记录敏感正文。

### Persistence

- [ ] localStorage schema version。
- [ ] parse 失败安全降级。
- [ ] 不持久化 Runtime secret/raw event。

---

## 20. Reliability Review Checklist

- [ ] initialize 有 timeout。
- [ ] request/response 有 correlation test。
- [ ] notification interleaving 有 integration test。
- [ ] child crash 能及时失败。
- [ ] invalid JSON 有明确错误。
- [ ] Abort 后 child 最终退出。
- [ ] close 有 timeout / force fallback。
- [ ] late event 不能污染新会话。
- [ ] duplicate event 处理可预测。
- [ ] completed snapshot 能最终收敛。
- [ ] restore/persist 不互相覆盖。
- [ ] 真实 Codex 有 protocol smoke test。
- [ ] 核心用户路径有少量 E2E。

---

## 21. 故障定位矩阵

| 现象 | 优先检查 |
|---|---|
| 无法启动 | codex path / spawn / auth / stderr |
| 一直 running | timeout / child exit / turn.completed |
| 没有逐字流式 | provider delta / normalizer / RPC buffering |
| New Chat 后旧消息回来 | generation guard / Abort |
| 刷新后历史丢失 | storage version / restore / persist |
| thread 无法继续 | threadId normalize / resume response |
| Browser 暴露敏感细节 | mapping / server error sanitization |
| 高并发串消息 | request dispatcher / correlation / turn filtering |

---

## 22. 思考题

1. 为什么 path security 必须使用 `realpath`，而不是只用 `resolve`？
2. 如果未来允许 command execution，read-only workspace 是否已经足够安全？
3. 哪些错误可以自动 retry，哪些绝不应该默认重试？
4. 为什么 generation guard 和 AbortSignal 必须同时存在？
5. 如果 `turn/completed` 丢失，系统应使用什么机制防止永久 running？
6. 如果 provider event 新增一个含 secrets 的字段，allow-list mapper 与 object spread 的安全结果有什么区别？
7. 如果所有 unit test 都通过，为什么仍然可能有 request correlation 生产 bug？
