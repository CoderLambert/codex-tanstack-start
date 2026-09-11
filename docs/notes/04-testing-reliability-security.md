# Agent Runtime 测试、可靠性与安全边界

> 本文不是“测试通过记录”，而是一份面向真实 Agent Runtime 工程的可靠性评审手册。示例以本仓库的 Codex app-server + TanStack Start 实现为背景，但方法同样适用于 Claude Code、Pi Agent、OpenCode、MCP Host、Local LLM Agent 等长生命周期、事件驱动、可执行工具的 Agent Runtime。

---

## 0. 先给出结论

传统 Web 请求通常可以简化为：

```text
request -> handler -> response
```

Agent Runtime 不行。一次用户请求可能经历：

```text
Browser
  -> TanStack Start RPC
  -> Runtime Adapter
  -> child process
  -> JSON-RPC initialize
  -> thread start/resume
  -> turn start
  -> model streaming
  -> tool / command / MCP
  -> token usage
  -> completion / failure / interrupt
  -> process cleanup
  -> UI state convergence
```

因此，“接口能返回文本”远远不能证明系统可靠。

Agent Runtime 的可靠性至少要同时证明四件事：

1. **协议正确**：request / response / notification 不串线，不错配。
2. **生命周期正确**：启动、流式执行、中断、退出、异常退出都能收敛。
3. **状态正确**：同一 turn 的事件只更新同一会话，最终状态可恢复、可重放、可持久化。
4. **安全边界正确**：浏览器只看到应用允许暴露的数据，而不是 Runtime 原始上下文。

本仓库目前已经有不错的单元测试基础，但 transport 与进程生命周期仍是最值得继续补强的部分。

---

# 1. 为什么 Agent Runtime 需要独立“可靠性层”

## 1.1 Agent 不是一次普通 API 调用

一个典型 REST handler 的失败边界通常比较局部：参数校验失败、数据库失败、第三方 API 失败。

Agent Runtime 则同时跨越：

- 浏览器状态
- Server Function
- Node.js 进程
- 子进程 stdin/stdout/stderr
- JSON-RPC request/response
- 异步 notification
- 模型生成
- 工具调用
- 文件系统
- MCP
- 本地认证
- 用户主动取消

每一层都可能独立失败。

因此 Runtime 最好被看成一个**独立基础设施组件**，而不是某个 React hook 后面的“请求函数”。

### 心智模型

```text
                 ┌───────────────────────┐
                 │     Product / UI      │
                 └───────────┬───────────┘
                             │ application events
                 ┌───────────▼───────────┐
                 │ Reliability Boundary  │
                 │                       │
                 │ correlation           │
                 │ cancellation          │
                 │ error normalization   │
                 │ process lifecycle     │
                 │ security filtering    │
                 │ observability         │
                 └───────────┬───────────┘
                             │ runtime protocol
                 ┌───────────▼───────────┐
                 │   Codex app-server    │
                 └───────────────────────┘
```

如果没有中间这一层，UI 会被迫理解：

- JSON-RPC id
- Codex item 类型
- approval request
- stderr
- interrupted turn
- child process crash
- token usage notification

这会把协议复杂度扩散到整个应用。

---

# 2. 本项目当前可靠性边界

当前主链路可以抽象为：

```text
React UI
  -> useChatController()
  -> TanStack Start createServerFn
  -> streamNormalizedChatEvents()
  -> CodexRuntime
  -> CodexAppServerRuntime
  -> AppServerConnection
  -> codex app-server --stdio
```

相关源码：

| 关注点 | 文件 |
|---|---|
| App Server 进程 / JSON-RPC | `src/server/codex/codex-app-server.server.ts` |
| Runtime 抽象 | `src/server/codex/codex-runtime.ts` |
| Runtime 错误分类 | `src/server/codex/codex.errors.ts` |
| Workspace 安全 | `src/server/codex/workspace.server.ts` |
| Runtime -> App Event | `src/server-functions/codex-event-normalizer.ts` |
| Streaming bridge | `src/server-functions/chat-stream.ts` |
| 浏览器 state adapter | `src/features/chat/chat-event.adapter.ts` |
| Reducer | `src/features/chat/chat.reducer.ts` |
| stale stream guard | `src/features/chat/use-chat-controller.ts` |
| 浏览器持久化 | `src/features/chat/chat.storage.ts` |

可靠性评审时，不应该逐文件孤立查看，而应沿一条 turn 的完整生命周期检查。

---

# 3. 测试金字塔：不同测试证明不同事情

Agent Runtime 最常见的误区是：

> “39 个测试都通过，所以 Runtime 没问题。”

测试数量没有意义，关键是它覆盖了哪一层风险。

## 3.1 推荐测试金字塔

```text
                      ┌───────────────┐
                      │ E2E / System  │  少量
                      └───────┬───────┘
                    ┌─────────▼─────────┐
                    │ Smoke / Protocol  │
                    └─────────┬─────────┘
               ┌──────────────▼──────────────┐
               │ Integration / Fake Runtime │
               └──────────────┬──────────────┘
          ┌───────────────────▼───────────────────┐
          │              Unit Tests              │  大量
          └───────────────────────────────────────┘
```

## 3.2 Unit Test：证明局部纯逻辑

适合验证：

- 参数校验
- thread id normalize
- workspace path 限制
- error classification
- event mapping
- reducer
- storage serialization
- snapshot -> delta 算法

当前项目已经覆盖了不少这一层：

```text
workspace.test.ts
codex.errors.test.ts
thread-selection.test.ts
codex-app-server.test.ts
chat.validation.test.ts
codex-event-normalizer.test.ts
chat-stream.test.ts
chat.reducer.test.ts
chat.storage.test.ts
chat-event.adapter.test.ts
use-chat-controller.test.ts
```

这些测试价值很高，但它们无法证明真实 transport 没有竞态。

## 3.3 Integration Test：证明组件之间的协议

这一层应该验证：

```text
AppServerConnection
  + fake child process
  + JSON-RPC
  + notification buffering
  + streamTurn()
```

典型断言：

- initialize 必须先于 thread/start。
- request id 必须与 response 正确匹配。
- response 到达前的 notification 不得丢失。
- server request 必须被明确响应或拒绝。
- 其它 turn 的 notification 不得污染当前 turn。
- app-server 提前退出必须使 generator 失败，而不是永久 pending。
- abort 后 child process 必须最终退出。

当前项目最缺的就是这一层。

## 3.4 Smoke Test：证明真实 Codex 能工作

Smoke Test 不需要覆盖所有分支，它回答：

> “当前安装的 Codex、当前协议、当前认证，在真实机器上还能跑通吗？”

建议最小 smoke：

```text
initialize
-> thread/start
-> turn/start
-> item/started(agentMessage)
-> item/agentMessage/delta × N
-> item/completed(agentMessage)
-> turn/completed
```

还应检查：

- 至少收到一个 delta。
- completed 文本与拼接后的 delta 逻辑一致。
- turn 最终状态为 completed。
- app-server 能正常退出。

## 3.5 E2E：证明用户路径

E2E 重点不是 JSON-RPC，而是：

```text
用户发送消息
-> UI 立即进入 running
-> 文本持续增长
-> 页面保持可用
-> 最终文本正确
-> refresh 后 conversation 恢复
-> New Chat 不被旧流污染
```

E2E 应该少而稳定。

---

# 4. JSON-RPC 生命周期到底要测什么

Codex app-server 通过 stdio 使用 JSON-RPC 风格消息。

客户端会面对三种不同语义：

```text
Request      { id, method, params }
Response     { id, result | error }
Notification { method, params }
```

还有第四种经常被忽略的情况：

```text
Server Request { id, method, params }
```

也就是 app-server 主动要求客户端回答，例如 approval 类请求。

---

## 4.1 request id 是并发正确性的第一道防线

当前 `AppServerConnection` 使用递增 id：

```ts
const id = ++this.requestId
stdin.write(JSON.stringify({ id, method, params }))
```

这本身没有问题。

真正需要验证的是：

```text
request A id=1
request B id=2

response id=2
response id=1
```

客户端不能假定 response 顺序与 request 顺序相同。

当前实现的 `request()` 是同步消费一个共享 async iterator，因此设计本身更偏向“同一时刻只有一个 request 在等待”。如果未来一个长连接上并发调用：

```text
turn/start
thread/read
turn/interrupt
```

就需要一个真正的 dispatcher：

```ts
Map<RequestId, Deferred<Response>>
```

由唯一 reader loop 负责路由。

### 通用架构

```text
stdout
  │
  ▼
Reader Loop
  │
  ├─ has id + response -> pendingRequests[id].resolve()
  │
  ├─ has id + method   -> serverRequestHandler()
  │
  └─ has method only   -> notification subscribers
```

这是 long-lived app-server 客户端最终更稳的形态。

---

# 5. Notification buffering 为什么很重要

一个常见错误是假设：

```text
request
-> response
-> notifications
```

真实协议可能出现：

```text
request turn/start
-> turn/started notification
-> item/started notification
-> response turn/start
-> delta
```

当前项目的 `request()` 会在等待 response 时把 notification 暂存到数组：

```ts
const notifications = []

while (...) {
  const message = await nextMessage()

  if (message.id === id) return { response, notifications }
  if (message.method) notifications.push(message)
}
```

这是一个重要设计点。

必须补测试证明：

1. response 前 notification 不丢。
2. 缓冲顺序保持原顺序。
3. server request 不应被误当 notification。
4. response error 时，已缓冲 notification 如何处理必须有明确语义。

### 推荐断言

```ts
expect(events.map(e => e.type)).toEqual([
  'turn.started',
  'item.started',
  'item.agent_message.delta',
  'item.completed',
  'turn.completed',
])
```

不要只断言“最终有 Hello”。

---

# 6. threadId / turnId correlation 是 Agent 并发的核心

Agent 协议里最容易出现的竞态之一是：

> 收到了一个合法 notification，但它不是当前这个 turn 的。

## 6.1 为什么 threadId 不够

一个 thread 可以有多个 turn：

```text
Thread T1
  ├─ Turn A
  ├─ Turn B
  └─ Turn C
```

如果仅按 thread 过滤：

```text
turn A 结束
turn B 刚启动
```

旧的 `turn/completed(A)` 可能错误结束 B 的前端 stream。

## 6.2 应同时关联 threadId 与 turnId

推荐上下文：

```ts
type ActiveTurn = {
  threadId: string
  turnId: string
}
```

只接受属于当前 turn 的事件：

```ts
if (notification.threadId !== active.threadId) return
if (notification.turnId !== active.turnId) return
```

实际不同 notification 的字段结构可能不同，所以 adapter 层应负责统一提取 correlation metadata。

## 6.3 当前项目的风险

当前 `streamTurn()` 在看到：

```text
message.method === 'turn/completed'
```

时就直接 return。

它没有显式保存并校验 `turn/start` 返回的 `turnId`。

在“一次 turn 一个 app-server 子进程”的当前 V0 架构下，这个问题较难触发；但一旦升级为 long-lived app-server、并行 thread、多窗口或真正 interrupt，这会立即成为正确性问题。

## 6.4 必须有的测试

Fake Server 发出：

```text
turn/start response: turn=A

delta turn=B       -> ignore
turn/completed B   -> MUST NOT finish

delta turn=A       -> accept
turn/completed A   -> finish
```

这是比“能收到 delta”更重要的集成测试。

---

# 7. Fake App Server：最值得补的一层

真实 Codex 不适合承担所有 integration test：

- 慢
- 依赖登录
- 依赖模型可用性
- 输出非确定
- CI 不稳定

因此应实现可脚本化 Fake Transport。

## 7.1 Fake Server 的目标

不是模拟模型能力，而是模拟协议。

最小能力：

```text
读取 stdin JSONL
根据 method 返回 response
按脚本插入 notification
可模拟 stderr
可模拟 crash
可模拟永不响应
可记录客户端写入
```

## 7.2 示例结构

```ts
type FakeStep =
  | { type: 'expect-request'; method: string }
  | { type: 'respond'; idFromLastRequest: true; result: unknown }
  | { type: 'notify'; method: string; params: unknown }
  | { type: 'stderr'; text: string }
  | { type: 'exit'; code: number }
  | { type: 'hang' }
```

一个完整脚本：

```ts
const scenario = [
  expectRequest('initialize'),
  respond({ userAgent: 'fake' }),
  expectNotification('initialized'),

  expectRequest('thread/start'),
  respond({ thread: { id: 'thread-1' } }),

  expectRequest('turn/start'),
  notify('turn/started', { threadId: 'thread-1', turn: { id: 'turn-1' } }),
  respond({ turn: { id: 'turn-1' } }),

  notify('item/started', ...),
  notify('item/agentMessage/delta', ...),
  notify('item/completed', ...),
  notify('turn/completed', ...),
]
```

## 7.3 Fake Server 不应测试业务文案

它应该测试的是协议不变量：

```text
顺序
归属
结束条件
异常传播
取消
清理
```

---

# 8. Child Process 生命周期：spawn 成功只是开始

当前 Runtime 每次 turn：

```text
new AppServerConnection
-> spawn codex app-server --stdio
-> initialize
-> run
-> finally close
```

这种 process-per-turn 设计对 Demo 有两个优点：

- 故障隔离简单。
- turn 结束后资源天然回收。

代价是：

- 每轮都需要启动进程。
- 无法自然利用长期连接。
- interrupt / steer / 多并发 thread 会变复杂。

---

## 8.1 spawn 需要覆盖哪些错误

至少包括：

```text
ENOENT              codex 不存在
EACCES               无执行权限
进程启动后秒退
stdout 非 JSON
stderr 大量输出
stdin broken pipe
进程挂死
```

仅靠：

```ts
spawn(...)
```

并不足以证明 runtime 已启动。

最好有明确状态：

```text
created
-> spawned
-> initialized
-> ready
-> closing
-> closed
```

---

# 9. stderr 不是普通日志

当前实现把 stderr 累积：

```ts
this.stderr += chunk
```

当 stdout 结束时，将 stderr 拼入 Error。

这种方式方便开发，但有两个风险。

## 9.1 内存风险

如果子进程持续写 stderr：

```text
10MB
100MB
1GB
```

字符串会无限增长。

推荐使用 ring buffer 或最大长度：

```ts
const MAX_STDERR = 32 * 1024
```

只保留末尾诊断信息。

## 9.2 信息泄漏风险

stderr 可能包含：

- 本地绝对路径
- command
- 环境信息
- provider error
- request metadata

因此：

```text
stderr -> server diagnostics
```

而不是：

```text
stderr -> browser error message
```

---

# 10. SIGTERM / SIGKILL：close() 必须最终结束

当前 `close()`：

```ts
child.once('exit', resolve)
child.kill()
```

默认发送 SIGTERM。

问题是：SIGTERM 不保证进程退出。

如果 child 卡死：

```text
finally
 -> await close()
 -> 永远等待 exit
```

请求本身会挂死。

## 10.1 推荐两阶段关闭

```text
close()
  │
  ├─ stdin.end()
  ├─ SIGTERM
  │
  ├─ wait gracePeriod
  │
  └─ SIGKILL
```

示意：

```ts
async function terminate(child: ChildProcess) {
  if (child.exitCode !== null) return

  child.kill('SIGTERM')

  const exited = await waitForExit(child, 1500)
  if (exited) return

  child.kill('SIGKILL')
  await waitForExit(child, 1000)
}
```

还应满足：

- close 幂等。
- 多次 abort 不抛异常。
- 已退出进程不会再次 kill。

---

# 11. Abort 与 Interrupt 是两件完全不同的事

这是 Agent UI 中非常重要的知识点。

## 11.1 Abort：停止本地消费

例如：

```text
AbortController.abort()
```

含义可能只是：

> “浏览器/Server 不再等待这个 stream。”

它不保证模型停止生成。

## 11.2 Interrupt：停止远端/Runtime 的 turn

对 Codex app-server，真正的业务取消语义是对运行中的 turn 发 interrupt。

概念上：

```text
turn/interrupt({ threadId, turnId })
```

截至 2026 年 9 月，Codex 社区围绕 interrupt race 仍有持续讨论：严格依赖 renderer 持有的 turnId 会存在 stale-turn 竞态，因此 stop 设计必须把 turn correlation 当作一等公民，而不能只“取消前端 fetch”。

## 11.3 当前项目 New Chat 的语义

`useChatController()` 使用：

```ts
generationRef.current += 1
```

之后旧 stream event 会被忽略。

这解决的是：

```text
stale stream -> 新 UI 污染
```

但没有自动证明：

```text
模型已经停止生成
子进程已经停止
token 不再消耗
```

所以 generation guard 是**UI 一致性机制**，不是 Runtime cancellation。

### 推荐 Stop 链路

```text
User clicks Stop
   │
   ├─ UI marks cancelling
   │
   ├─ server calls turn/interrupt(threadId, turnId)
   │
   ├─ abort browser stream if needed
   │
   └─ wait for terminal turn/completed(interrupted)
```

---

# 12. Server Request 与 Approval：不能“假装不存在”

App Server 不只向客户端发 notification，也可能发送需要回答的 server request。

当前实现识别：

```ts
message.id !== undefined && message.method !== undefined
```

然后统一返回：

```text
Interactive server requests are disabled.
```

对于当前：

```text
approvalPolicy: never
sandbox: read-only
```

这是合理的 V0 防御策略。

但长期设计要注意：

- “不支持 approval”应该显式拒绝。
- 不能不响应。
- 不响应 server request 可能让 app-server 永久等待。

可靠性原则是：

> 对每种需要 response 的协议消息，要么支持，要么明确失败，不能沉默。

---

# 13. 错误分类：错误不是一个字符串

当前 `CodexRuntimeErrorCode` 包含：

```text
INVALID_INPUT
INVALID_WORKSPACE
AUTH_REQUIRED
RUNTIME_START_FAILED
CODEX_RUNTIME_FAILED
```

这比直接把 `Error.message` 传 UI 好得多。

但实际生产 Agent Runtime 通常还值得增加：

```text
CANCELLED
TIMEOUT
PROTOCOL_ERROR
PROCESS_EXITED
TURN_FAILED
MODEL_UNAVAILABLE
RATE_LIMITED
APPROVAL_REJECTED
```

## 13.1 三层错误模型

推荐区分：

### Internal diagnostic

完整：

```text
stack
stderr
path
raw provider message
request id
thread id
turn id
```

只在 server observability。

### Application error

结构化：

```ts
{
  code: 'AUTH_REQUIRED',
  retryable: false,
  correlationId: '...'
}
```

### User-facing message

简洁：

```text
Codex 尚未登录，请先在本机完成登录。
```

三者不要共用同一个字符串。

---

# 14. Browser 错误收敛：不要依赖 regex 做最后一道防线

当前 normalizer 已经会对 token 形态进行脱敏，这是必要的。

但错误信息还可能包含：

```text
/home/user/private/project
/tmp/codex-xxxx
command arguments
provider endpoint
local environment
```

因此更稳的原则是：

```text
未知 Runtime Error
  -> server log 完整错误
  -> browser 返回固定 application error
```

而不是：

```text
raw error
  -> regex 删除几个 token
  -> browser
```

regex 应作为 defense-in-depth，而不是主要安全模型。

---

# 15. 安全边界：哪些内容绝对不应该进 Browser

本项目目前的设计目标是浏览器只收到应用自己的 `ChatEvent`。

应该允许：

```text
opaque threadId
assistant text
activity type / status
有限的 command summary
token usage aggregate
sanitized application error
```

应该禁止：

```text
raw Codex protocol object
reasoning 原文
command stdout / stderr
MCP arguments
MCP result
认证 token
~/.codex 内容
任意环境变量
本地绝对路径
未经审核的 provider error
```

## 15.1 为什么 reasoning 不能顺手传过去

不仅是产品体验问题。

reasoning 可能间接包含：

- 文件内容
- 用户数据
- 内部路径
- tool response
- 未过滤上下文

所以：

```text
reasoning item
 -> activity(kind='reasoning', status='running')
```

比直接发送 reasoning text 更安全。

## 15.2 MCP 为什么尤其敏感

MCP arguments/result 可能包含：

```text
GitHub token
数据库内容
文件内容
用户邮件
内部 API response
```

当前 runtime adapter 主动把：

```ts
arguments: undefined
result: undefined
```

映射过边界，是正确方向。

---

# 16. read-only sandbox 是防线，不是安全证明

当前 Runtime：

```text
sandbox: read-only
sandboxPolicy.networkAccess: false
approvalPolicy: never
```

这显著降低风险，但不能理解成：

> “所以任何 Runtime 输出都是安全的。”

read-only 主要控制**副作用能力**，不自动解决：

- 读取敏感文件
- 错误泄漏路径
- stdout 泄漏
- prompt injection
- MCP 数据泄漏
- 本地认证信息暴露
- 资源耗尽

因此完整安全模型是多层的：

```text
Workspace restriction
  + sandbox
  + network policy
  + approval policy
  + runtime event filtering
  + browser contract
  + error normalization
  + tests
```

任何单层都不是最终答案。

---

# 17. Workspace 安全测试应该验证什么

`workspace.server.ts` 是很重要的安全边界。

建议测试：

- 合法相对路径。
- root 本身。
- `../` 越界。
- symlink 越界。
- 不存在目录。
- 文件而不是目录。
- 空字符串。
- absolute path 在 root 内。
- absolute path 在 root 外。

尤其要注意：

```text
字符串前缀检查 != 文件系统安全检查
```

例如：

```text
/root/project-safe
/root/project-safe-evil
```

不能只靠 `startsWith()` 判断边界。

---

# 18. Reducer 测试：纯函数不是风格问题

React reducer 最重要的不变量：

```text
same state + same action -> same next state
```

当前 reducer 在两个 fallback 分支里调用：

```ts
Date.now()
```

这意味着同样输入可能得到不同输出。

### 为什么测试阶段要在意

如果 reducer 不纯：

- replay 不确定。
- snapshot 测试不稳定。
- Strict Mode 更难推理。
- event sourcing 无法可靠重放。

正确做法是时间在 reducer 外生成：

```ts
{
  type: 'assistant.delta',
  id,
  delta,
  receivedAt
}
```

reducer 只消费值。

### 推荐 invariant test

```ts
const a = reducer(state, action)
const b = reducer(state, action)
expect(a).toEqual(b)
```

这类测试比只断言某字段更能保护架构。

---

# 19. 状态持久化测试：不要只测 JSON stringify

当前 persistence 只保存：

```text
threadId
messages
```

不保存：

```text
running state
activities
error
raw runtime event
```

这是合理的。

## 19.1 推荐测试矩阵

| 场景 | 预期 |
|---|---|
| 正常 conversation | round-trip 一致 |
| schema version 不支持 | 忽略/迁移，不 crash |
| JSON 损坏 | 回退空状态 |
| message 缺字段 | 拒绝非法数据 |
| localStorage quota error | UI 仍能聊天 |
| refresh 时上次 turn 正在 running | 恢复为稳定 idle，而不是伪造 running |
| New Chat | storage 清空 |

## 19.2 持久化的是产品状态，不是 Runtime 状态

浏览器保存的 `threadId` 只是重新关联 Codex thread 的 key。

真正 thread 历史仍由 Codex 管理。

这两个 persistence domain 不应该混为一谈。

---

# 20. stale stream：最典型的前端并发问题

假设：

```text
Turn A 正在流式输出
用户点击 New Chat
Turn B 开始
Turn A 又返回一个 delta
```

如果没有 guard：

```text
A.delta -> B UI
```

当前项目使用 generation：

```text
streamGeneration === currentGeneration
```

这是一种简单有效的 logical cancellation。

## 20.1 应补的场景

不仅测试 helper：

```ts
isCurrentChatGeneration(3, 4) === false
```

还应做 controller integration test：

```text
send A
-> yield delta A1
-> New Chat
-> fake stream yield A2
-> assert A2 未进入 state
```

这样才能证明 guard 真正接在线路上。

---

# 21. 并发场景清单

Agent Runtime review 时建议固定检查：

```text
同一 UI 连续双击 Send
New Chat while running
Stop 与 turn/completed 同时发生
Abort 与 child exit 同时发生
两个 browser tab resume 同一个 thread
两个 turn 几乎同时 start
旧 turn terminal event 晚到
server function disconnect 但 runtime 未停止
```

这些问题大部分无法靠普通单元测试发现。

---

# 22. 故障注入矩阵

这是可靠性测试最实用的一张表。

| 故障点 | 注入方式 | 必须观察的结果 |
|---|---|---|
| codex 不存在 | spawn ENOENT | `RUNTIME_START_FAILED`，请求结束 |
| 未登录 | fake RPC auth error | `AUTH_REQUIRED`，不泄漏 raw token |
| initialize error | response.error | stream fail，child 被回收 |
| stdout 非 JSON | 输出非法行 | protocol error，child 被回收 |
| response 永不到达 | hang | timeout/abort 可终止 |
| response 前有 notification | notify then respond | notification 不丢 |
| stderr 爆量 | 连续写 stderr | 内存有上限 |
| child 秒退 | exit(1) | generator 失败，不 pending |
| child 忽略 SIGTERM | trap signal | 超时后 SIGKILL |
| 其它 turn delta | turnId=B | 当前 turn 不接收 |
| 其它 turn completed | turnId=B | 当前 stream 不结束 |
| 当前 turn interrupted | terminal interrupted | UI 收敛为 cancelled/error 策略 |
| MCP payload 含 secret | arguments/result 注入 | Browser event 无 secret |
| error 含绝对路径 | `/home/...` | Browser 不出现真实路径 |
| localStorage 损坏 | 非法 JSON | 空状态恢复 |
| New Chat 后旧 delta | delayed event | 不污染新对话 |

如果一个 Agent Runtime 没有故障注入测试，通常只能证明 happy path。

---

# 23. 哪些测试通过，仍然不能证明 Runtime 正确

## 23.1 “event normalizer 单测通过”

不能证明：

- notification 没丢。
- request id 没串。
- event 属于当前 turn。

## 23.2 “reducer 单测通过”

不能证明：

- server stream 真的是增量到达。
- New Chat 后 server 已取消。
- UI 没收到旧 turn event。

## 23.3 “npm run build 通过”

不能证明：

- 本机存在 codex executable。
- 用户已登录。
- app-server protocol 与当前代码兼容。

## 23.4 “真实 smoke 通过一次”

不能证明：

- crash path 正确。
- interrupt race 正确。
- 多 turn 并发正确。

## 23.5 “read-only sandbox 已开启”

不能证明：

- 敏感读取不会发生。
- error 不泄漏本地信息。
- MCP payload 不会进入浏览器。

可靠性必须靠**分层证据组合**，不能靠一个绿色勾。

---

# 24. Logging 与 Observability

可靠性问题如果无法重现，日志就是唯一证据。

但 Agent Runtime 日志不能简单打印 raw event。

## 24.1 推荐结构化日志字段

```text
requestCorrelationId
threadId (可 hash / truncate)
turnId (可 hash / truncate)
eventType
itemType
itemId
processPid
latencyMs
exitCode
signal
errorCode
```

文本只记录长度：

```text
assistantDeltaLength=37
```

而不是：

```text
assistantDelta="用户的敏感内容..."
```

## 24.2 建议指标

```text
runtime_start_latency
first_delta_latency
turn_duration
interrupt_latency
child_exit_latency
unexpected_process_exit_count
protocol_error_count
turn_failed_count
```

这些指标能帮助区分：

```text
模型慢
网络慢
app-server 慢
前端不更新
进程卡死
```

---

# 25. CI 应该验证什么

标准 CI：

```text
install
-> typecheck
-> unit tests
-> build
```

是基础，不是完整 Runtime CI。

更理想的分层：

```text
PR CI
  ├─ lint/typecheck
  ├─ unit
  ├─ fake-app-server integration
  └─ build

Nightly / dedicated host
  ├─ real codex smoke
  ├─ login/auth check
  ├─ interrupt smoke
  └─ protocol compatibility
```

原因是真实 Codex smoke 通常需要：

- 安装 Codex CLI。
- 本地认证。
- 模型权限。

不适合让每个普通 PR 都依赖它。

---

# 26. 当前代码审查：做得好的地方

以下设计值得保留。

## 26.1 Runtime boundary 独立

`CodexRuntime` interface 把 UI 与 Codex app-server 解耦。

未来可以实现：

```text
CodexAppServerRuntime
ClaudeCodeRuntime
PiRuntime
FakeRuntime
```

这是测试能力的基础。

## 26.2 Browser 不接触 raw protocol

Runtime 先转为内部事件，再转 `ChatEvent`。

这是正确的安全边界和架构边界。

## 26.3 MCP payload 主动清空

不是依赖 UI “不要显示”，而是在 server seam 就丢弃，这是正确层级。

## 26.4 completed snapshot 校准

delta 用于实时显示，completed full text 用于最终校准。

这是可靠流式 UI 的好模式：

```text
incremental UX
+
terminal authoritative snapshot
```

## 26.5 generation guard

它不等于 interrupt，但作为 UI stale-event protection 是有效且成本很低的。

---

# 27. 当前代码审查：优先补强项

按风险排序：

## P1：turnId correlation

当前 stream 终止主要按 `turn/completed` method 判断，应显式绑定当前 `turnId`。

## P1：Reducer purity

移除 reducer 内 `Date.now()`，把时间放进 event。

## P1/P2：真实 interrupt

New Chat / Stop 最终应能触达 Runtime，而不是只忽略旧 stream。

## P2：close timeout + SIGKILL

保证 child process 最终回收。

## P2：Fake App Server integration suite

覆盖 JSON-RPC 与 lifecycle。

## P2：Browser error convergence

未知 runtime error 不直接透传完整 message。

## P2：stderr memory bound

避免无限字符串增长。

---

# 28. 推荐测试目录演进

可以逐步形成：

```text
src/server/codex/
  codex-app-server.server.ts
  codex-app-server.mapping.test.ts
  codex-app-server.integration.test.ts
  fake-app-server.ts
  process-lifecycle.test.ts

src/server-functions/__tests__/
  chat-stream.test.ts
  codex-event-normalizer.test.ts
  security-boundary.test.ts

src/features/chat/
  chat.reducer.test.ts
  chat.storage.test.ts
  use-chat-controller.integration.test.ts
```

原则是按失败边界拆，而不是按“哪个文件需要 coverage”拆。

---

# 29. Reliability Review Checklist

在合并 Agent Runtime 改动前，可以逐项检查。

## Protocol

- [ ] 每个 request 都有唯一 id。
- [ ] response 通过 id 路由，而不是依赖顺序。
- [ ] response 前到达的 notification 不丢失。
- [ ] server request 有明确 response。
- [ ] 当前事件验证 threadId / turnId。
- [ ] terminal event 只结束对应 turn。

## Process

- [ ] spawn error 可观察。
- [ ] child exit 不会让 generator 永久 pending。
- [ ] stderr 有大小上限。
- [ ] close 幂等。
- [ ] SIGTERM 有超时。
- [ ] 超时后 SIGKILL。

## Cancellation

- [ ] UI stale stream guard 存在。
- [ ] Browser abort 与 Runtime interrupt 语义区分。
- [ ] Stop 能定位当前 turn。
- [ ] interrupt 与 natural completion race 有测试。

## State

- [ ] reducer 为纯函数。
- [ ] delta 顺序正确。
- [ ] completed snapshot 最终校准。
- [ ] refresh 恢复稳定状态。
- [ ] New Chat 不接收旧 stream。

## Security

- [ ] raw runtime event 不到浏览器。
- [ ] reasoning 原文不暴露。
- [ ] command stdout/stderr 不暴露。
- [ ] MCP arguments/result 不暴露。
- [ ] token 不暴露。
- [ ] 本地绝对路径不暴露。
- [ ] workspace 越界有测试。
- [ ] sandbox/network/approval policy 有测试或 smoke 验证。

## Testing

- [ ] unit tests。
- [ ] fake transport integration。
- [ ] real app-server smoke。
- [ ] 至少一个完整 UI E2E。
- [ ] 故障注入覆盖关键异常。

---

# 30. 调试 Checklist

遇到“Codex 卡住 / 前端不更新”时，不要从 React 开始盲查。

推荐固定顺序：

```text
1. child 是否存在？
2. initialize 是否成功？
3. thread/start or resume 是否返回？
4. turn/start 返回的 threadId / turnId 是什么？
5. 是否收到 turn/started？
6. 是否收到 item/started(agentMessage)？
7. 是否收到 item/agentMessage/delta？
8. delta 是否通过 normalizer？
9. TanStack stream 是否真的 yield？
10. controller 是否 dispatch？
11. generation guard 是否把它过滤了？
12. reducer 是否更新同一 message id？
13. turn/completed 是否属于当前 turn？
14. finally 是否回收 child？
```

日志只需要记录：

```text
event type
thread id suffix
turn id suffix
item type
item id suffix
text length
status
```

不要为了调试直接打印完整 event。

---

# 31. 常见反模式

## 31.1 “能聊天就是集成测试”

只能证明 happy path。

## 31.2 用字符串定时器模拟流式

```ts
setInterval(() => revealNextCharacter(), 20)
```

这是动画，不是 runtime streaming。

## 31.3 浏览器直接消费 provider 协议

导致安全边界、协议升级和多 Runtime 适配全部耦合到 UI。

## 31.4 取消 fetch 就当停止 Agent

可能仍然消耗 token、运行 command 或等待工具。

## 31.5 catch 后直接返回 `error.message`

会让内部实现细节越过 trust boundary。

## 31.6 child.kill() 后无限 await exit

在异常进程上会永久挂起。

## 31.7 只测试 final text

会漏掉 notification 顺序、重复 delta、错误 correlation。

## 31.8 为 coverage 而 mock 掉所有真正危险的边界

如果把 child process、transport、stream 全 mock 掉，测试只能证明自己的 mock。

---

# 32. 可迁移到其他 Agent Runtime 的工程模式

这个项目最值得复用的不是某个 Codex method 名，而是这些模式。

## Pattern 1：Runtime Adapter

```text
Provider protocol
-> Runtime-owned internal events
-> Application events
```

## Pattern 2：Streaming lifecycle

```text
started
-> delta × N
-> completed(authoritative snapshot)
```

## Pattern 3：Correlation-first

```text
session/thread id
+
turn/run id
+
item id
```

每层都有唯一身份。

## Pattern 4：Logical cancellation + physical cancellation

```text
UI generation guard
+
Runtime interrupt
```

两者各解决不同问题。

## Pattern 5：Security at seam

敏感数据在 server seam 丢弃，而不是到 UI 后再隐藏。

## Pattern 6：Fake protocol server

用确定性 fake server 测协议，把真实模型留给 smoke。

---

# 33. 复习题

## 基础

1. 为什么 `item/agentMessage/delta` 的存在不能证明前端一定是真流式？
2. request、response、notification、server request 四种消息的区别是什么？
3. 为什么 response 不能只靠到达顺序匹配 request？
4. 为什么 completed snapshot 仍有价值？
5. 为什么 `generationRef` 不等于 interrupt？

## 工程

6. 如果 response 到达前已经产生三个 delta，client 应如何处理？
7. 一个 long-lived app-server 同时处理多个 thread 时，为什么必须检查 turnId？
8. child process 忽略 SIGTERM 时应该怎么办？
9. 为什么 stderr 应该有 ring buffer 上限？
10. 为什么 raw provider error 不适合直接给浏览器？

## 安全

11. read-only sandbox 能阻止哪些风险？不能阻止哪些风险？
12. 为什么 MCP result 即使 UI 不展示，也不应该传到 Browser？
13. reasoning text 为什么应该在 server 边界被丢弃？
14. workspace path 校验为什么不能只做字符串前缀比较？

## 测试设计

15. Unit test、Fake Runtime integration、real smoke、E2E 分别证明什么？
16. 设计一个 fake scenario，证明其它 turn 的 completed 不会结束当前 turn。
17. 如何测试 abort 与 natural completion 同时发生的 race？
18. 如何证明 reducer 真正是纯函数？
19. “39 tests passed”为什么仍可能存在严重 runtime bug？
20. 如果只能新增 5 个测试，你会优先增加哪 5 个？为什么？

---

# 34. 最终总结

Agent Runtime 的测试重点不是覆盖率，而是**不变量**。

真正要保护的是：

```text
事件不丢
事件不串
进程不泄漏
取消能落地
错误能收敛
状态可重放
敏感数据不过界
```

把这些不变量放到架构中心后，测试策略会自然分层：

```text
纯逻辑 -> Unit
协议生命周期 -> Fake App Server Integration
真实兼容性 -> Smoke
用户路径 -> E2E
异常保证 -> Fault Injection
```

对于当前仓库，下一阶段最值得投入的不是继续堆 reducer 单测，而是建立 **Fake App Server + turn correlation + interrupt + process termination** 的可靠性测试层。

这也是从“Demo 能跑”进入“Agent Runtime 可以长期演进”的关键分界线。

---

## 参考与进一步阅读

- OpenAI Codex repository：`https://github.com/openai/codex`
- Codex App Server API development guidance：`codex/AGENTS.md` 中的 App-server API Development Best Practices
- Codex App Server 相关实现位于 `codex-rs/app-server*` 与 `codex-rs/app-server-protocol*`
- 2026-08-26 的 Codex issue #40953 讨论了基于 `turn/interrupt({ threadId, turnId })` 的 stale turn race，以及为什么 Stop API 需要严格的 turn correlation

> 协议字段会随 Codex 版本演进。本文的工程原则应长期有效，但具体 method / payload 应在升级 Codex 后重新对照当前 app-server v2 schema。