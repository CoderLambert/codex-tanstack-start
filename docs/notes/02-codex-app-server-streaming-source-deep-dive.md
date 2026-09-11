# Codex App Server Streaming：源码驱动的 Runtime 深挖

> 基线：`main@294ecae6`
>
> 本文围绕 `src/server/codex/codex-app-server.server.ts` 的真实实现，重点理解：child process、stdio 协议、request/response correlation、notification、AsyncGenerator、AbortSignal、资源释放和供应商协议防腐层。统一模板：**源码位置 → 为什么需要 → 定义 → 当前实现 → 生产风险 → 工业级范式 → 复习检查**。

---

## 1. Runtime 的真正职责：把“进程协议”变成“应用事件流”

当前 Runtime 做的事情可以压缩为：

```text
spawn codex app-server
  ↓
initialize handshake
  ↓
thread/start | thread/resume
  ↓
turn/start
  ↓
consume stdout messages
  ↓
map provider event
  ↓
yield CodexThreadEvent
  ↓
cleanup child process
```

因此 Runtime 不是“调用模型 API 的函数”，而是一个**协议客户端 + 生命周期管理器 + 数据翻译器**。

对应源码：

```text
src/server/codex/codex-app-server.server.ts
src/server/codex/codex-runtime.ts
src/server/codex/codex.errors.ts
src/server/codex/thread-selection.server.ts
src/server/codex/workspace.server.ts
```

---

## 2. `spawn()`：为什么 Agent Runtime 更像进程监督而不是普通 HTTP 请求

源码：

```ts
this.child = spawn(codexPath, ['app-server', '--stdio'], {
  cwd: process.cwd(),
  stdio: 'pipe',
})
```

### 定义

Node `child_process.spawn()` 启动一个独立 OS 进程，并暴露：

```text
stdin  -> host 写给 child
stdout -> child 写给 host
stderr -> 诊断输出
exit   -> 生命周期信号
```

与 `exec()` 相比，`spawn()` 更适合长生命周期和流式协议，因为它不会先把整个输出缓存在内存里再返回。

### 为什么当前场景需要它

Codex App Server 是持续交互协议：

```text
host request
server response
server notification
host request
server notification
...
```

如果使用一次性命令执行模型：

```text
command -> wait -> whole output
```

就无法自然表达一个 turn 中持续出现的 delta、tool event 和 usage。

### 生产风险

child process 不是普通 Promise。必须处理：

- executable 不存在；
- 启动权限失败；
- stdout 提前关闭；
- stderr 持续增长；
- child 卡死；
- host 请求取消；
- parent 退出后 orphan process；
- kill 后进程没有及时退出。

### 工业级范式

把进程抽象成明确状态机：

```text
CREATED
  ↓ spawn
STARTING
  ↓ initialize
READY
  ↓ turn/start
RUNNING
  ↓ complete / fail / abort
CLOSING
  ↓ exit
CLOSED
```

生产实现最好对每个状态定义：

```text
允许的操作
超时
退出条件
日志字段
失败错误码
```

---

## 3. `readline` + AsyncIterator：为什么 stdout 是“消息流”而不是字符串

源码：

```ts
this.lines = createInterface({ input: this.child.stdout })
this.messages = this.lines[Symbol.asyncIterator]()
```

App Server 通过 newline-delimited JSON 风格的数据交换消息，因此 stdout 的正确抽象不是：

```text
一个大字符串
```

而是：

```text
message 1
message 2
message 3
...
```

### `Symbol.asyncIterator` 的意义

可以写出：

```ts
const next = await this.messages.next()
```

或者更高层：

```ts
for await (const line of lines) {
  // consume one message at a time
}
```

这使协议解析与 Node stream 的 chunk 边界解耦。TCP/pipe chunk 并不保证一次 data event 就对应一个完整 JSON message；按“行”解析才符合协议 framing。

### 生产避坑

永远不要写：

```ts
child.stdout.on('data', chunk => JSON.parse(chunk))
```

原因：

```text
一个 chunk 可能只有半条 JSON
一个 chunk 也可能包含多条 JSON
```

消息协议必须先处理 framing，再处理 parsing。

---

## 4. JSON-RPC correlation：为什么“发请求后读下一条消息”是错误模型

当前 `request()`：

```ts
const id = this.send(method, params)
const notifications: AppServerMessage[] = []

while (true) {
  const message = await this.nextMessage()

  if (message.id === id) {
    return { response: message, notifications }
  }

  if (this.isServerRequest(message)) {
    this.rejectServerRequest(message)
  } else if (message.method) {
    notifications.push(message)
  }
}
```

### 核心定义

RPC correlation 的本质：

```text
request id -> matching response
```

而不是：

```text
request -> next line is response
```

因为 response 到达前可能插入：

- notification；
- server request；
- 其它并发 request 的 response。

### 当前实现的能力边界

当前连接实现更适合：

```text
同一时刻一个 request() 顺序等待
```

而不是完整并发 dispatcher。

如果未来一个连接同时发：

```text
turn/start
thread/read
turn/interrupt
```

多个 `request()` 不能各自独立消费同一个 async iterator，否则会争抢消息。

### 工业级并发范式

应该升级成单一 reader loop：

```text
stdout
  ↓
one dispatcher
  ├─ response id -> pendingRequests Map
  ├─ notification -> event channel
  └─ server request -> request handler
```

伪代码：

```ts
const pending = new Map<RequestId, Deferred>()

for await (const message of source) {
  if (isResponse(message)) {
    pending.get(message.id)?.resolve(message)
  } else if (isNotification(message)) {
    publish(message)
  } else if (isServerRequest(message)) {
    handleServerRequest(message)
  }
}
```

这才支持真正的 multiplexing。

---

## 5. Request / Response / Notification / Server Request：四类消息必须严格区分

协议心智模型：

| 类型 | id | method | 谁发起 | 宿主动作 |
|---|---|---|---|---|
| Request | 有 | 有 | Host | 等 response |
| Response | 有 | 无 | Server | resolve pending request |
| Notification | 无 | 有 | Server | 转成事件 |
| Server Request | 有 | 有 | Server | 必须回答 |

当前代码识别 Server Request：

```ts
return (
  message.id !== undefined &&
  message.method !== undefined &&
  message.result === undefined &&
  message.error === undefined
)
```

V0 统一拒绝：

```ts
error: {
  code: -32000,
  message: 'Interactive server requests are disabled.',
}
```

### 为什么这是安全决策

因为 `approvalPolicy: never` 的 V0 不应该让 Runtime 在执行中临时向 Browser 请求权限升级。

### 未来怎么演进

不要直接改成“弹窗点允许”。应该引入：

```text
Server Request
  ↓ policy engine
capability + workspace + user policy
  ↓
approve / deny / require explicit user confirmation
  ↓
audit log
```

审批是安全协议，不是 UI 交互细节。

---

## 6. initialize / initialized：握手其实是连接状态机

源码：

```ts
await connection.request('initialize', {
  clientInfo: {...},
  capabilities: {
    experimentalApi: true,
    requestAttestation: false,
  },
})
connection.notify('initialized')
```

### 为什么不能跳过

握手用来确认：

- 客户端身份；
- 协议能力；
- 实验 API 支持；
- attestation 等交互能力。

这是一种 capability negotiation。

### 工业级范式

不要在业务逻辑里到处硬编码 capability JSON。长期应抽成：

```ts
interface RuntimeCapabilities {
  experimentalApi: boolean
  requestAttestation: boolean
  approvals: 'deny' | 'interactive'
}
```

并让初始化结果形成 ConnectionContext。

---

## 7. Thread resume：为什么浏览器给的 threadId 仍然不能直接信任

Runtime：

```ts
const threadId = normalizeThreadId(input.threadId)
const threadRequest = threadId ? 'thread/resume' : 'thread/start'
```

### 原则

来自 Browser 的任何标识符都属于外部输入：

```text
类型正确 ≠ 语义可信
```

即使 TypeScript 类型是 `string`，运行时仍可能收到：

- 空字符串；
- 非法格式；
- 超长值；
- stale id；
- 恶意构造值。

### 工业级范式

边界数据总是：

```text
unknown
  ↓ validate / normalize
trusted internal type
```

不要因为前后端共用 TypeScript 类型就省略运行时验证。

---

## 8. `mapAppServerItem()`：供应商对象为什么必须在 Runtime 内收敛

源码把 App Server item：

```text
agentMessage
reasoning
commandExecution
fileChange
mcpToolCall
webSearch
error
```

映射成内部 `CodexThreadItem`。

特别值得注意的是 MCP：

```ts
arguments: undefined,
result: undefined,
error: undefined,
```

这不是“数据没拿到”，而是数据最小化策略。

### 为什么

MCP arguments/result 可能包含：

- 文件正文；
- token；
- 用户数据；
- 系统路径；
- 第三方服务响应。

Runtime 层是最适合做第一轮脱敏的地方。

### 工业级范式

Mapping function 应被视为 security boundary：

```text
Provider Object
    ↓ allow-list mapper
Internal Runtime Event
```

优先白名单，不使用：

```ts
return { ...providerObject }
```

因为外部协议新增字段时，spread 会让新字段自动穿透安全边界。

---

## 9. Delta + Completed Snapshot：体验与最终事实必须分开

事件：

```text
item/agentMessage/delta × N
item/completed(agentMessage)
```

正确理解：

```text
delta = incremental transport
completed = authoritative snapshot
```

### 为什么 completed 不能省

实时 delta 可能因为：

- transport 丢失；
- reconnect；
- adapter bug；
- provider 修订；
- chunk 重复；

导致客户端拼出来的文本不完全可靠。

最终 snapshot 可以做 reconciliation：

```text
实时：append delta
结束：replace with final snapshot
```

这和数据库中的：

```text
optimistic projection + authoritative commit
```

非常相似。

---

## 10. Usage 是流式状态，不应假设只在结束时出现

源码：

```ts
case 'thread/tokenUsage/updated': {
  const last = ...
  if (last) usage.value = last
  return []
}
```

最后：

```ts
return [{ type: 'turn.completed', usage: usage.value }]
```

### 设计含义

Runtime 内维护一个最新 usage snapshot：

```text
usage notification × N
       ↓
latest usage state
       ↓
turn.completed
```

这说明协议中的“统计信息”也可能是流，而不是单个最终 response 字段。

### 生产演进

如果需要实时成本 UI，可以将 usage 变成显式 application event；如果产品暂时不需要，就保持 Runtime 内部收敛，避免无意义事件放大。

---

## 11. `AbortSignal`：取消必须从 UI 一直传播到资源层

源码：

```ts
if (input.signal?.aborted) {
  throw new Error('Codex turn was cancelled.')
}

const abortHandler = () => connection.close().catch(() => undefined)
input.signal?.addEventListener('abort', abortHandler, { once: true })
```

### 定义

AbortSignal 是 cooperative cancellation：

```text
caller 发出取消意图
callee 监听 signal
callee 主动停止工作并释放资源
```

它不是线程强杀机制。

### 为什么 generation guard 不够

前端 `generationRef` 只能做到：

```text
旧结果不再写入 UI
```

但后台 Codex 进程仍可能继续：

```text
占 CPU
占 token
占文件句柄
占 child process
```

真正取消必须让 signal 穿过：

```text
UI Stop
  ↓ Controller
AbortController
  ↓ Server/RPC
Runtime
  ↓
turn/interrupt 或 close child
```

### 工业级范式

区分：

```text
stale-result suppression
vs
underlying-work cancellation
```

两个都要有。

---

## 12. `try / finally`：资源释放比成功路径更重要

源码：

```ts
try {
  // initialize + turn
} catch (error) {
  throw normalizeCodexRuntimeError(error)
} finally {
  input.signal?.removeEventListener('abort', abortHandler)
  await connection.close()
}
```

### 为什么 `finally` 是 Runtime 核心

以下路径都必须释放：

```text
正常完成
RPC error
JSON parse error
用户 abort
app-server crash
mapper throw
consumer 提前停止 generator
```

只在“成功结束”时 close 是典型资源泄漏。

### 工业级检查表

每一种资源都问：

```text
谁创建？
谁拥有？
谁关闭？
异常路径是否关闭？
取消路径是否关闭？
关闭本身失败怎么办？
```

---

## 13. `close()` 的生产风险：kill 不等于可靠退出

当前：

```ts
this.child.once('exit', finish)
this.child.kill()
```

这是 V0 合理实现，但生产需要考虑：

```text
SIGTERM 后 child 不退出怎么办？
close 等待是否可能永久 pending？
是否需要 grace period？
是否最终 SIGKILL？
Windows signal 行为是否一致？
```

推荐状态：

```text
request graceful stop
  ↓ timeout
SIGTERM
  ↓ timeout
SIGKILL / platform equivalent
  ↓
record forced termination metric
```

不要让 cleanup 本身成为无限等待点。

---

## 14. Error Normalization：不要把底层错误字符串当领域模型

`codex.errors.ts` 定义：

```text
INVALID_INPUT
INVALID_WORKSPACE
AUTH_REQUIRED
RUNTIME_START_FAILED
CODEX_RUNTIME_FAILED
```

### 为什么要分类

上层真正关心的是：

```text
用户能不能修复？
应该重试吗？
应该引导登录吗？
是配置问题还是 Runtime crash？
```

而不是底层字符串：

```text
spawn ENOENT
401 unauthorized
some provider-specific message
```

### 当前风险

当前部分分类依赖字符串匹配：

```ts
normalized.includes('authentication')
normalized.includes('401')
```

这在 V0 可用，但长期脆弱。

### 工业级范式

优先级：

```text
结构化 provider error code
  > exit code / typed error
  > protocol status
  > 最后才是字符串 heuristic
```

并保持：

```text
internal detailed error
!=
public browser-safe error
```

---

## 15. Backpressure：AsyncGenerator 不是“无限快地推”

`streamTurn()` 是：

```ts
async *streamTurn(...) {
  yield event
}
```

消费者通过：

```ts
for await (const event of source) {
  // consume
}
```

### 心智模型

```text
producer yield
    ↓
consumer next()
    ↓
producer resumes
```

这提供天然的 cooperative backpressure。

但要注意：底层 app-server 仍持续写 stdout。如果 UI 或 RPC 消费明显慢于 provider，仍需要考虑：

- pipe buffer；
- 内存队列；
- event batching；
- slow consumer metrics。

AsyncGenerator 能改善模型，但不会自动解决所有流控问题。

---

## 16. 当前实现最值得继续演进的三个点

### 16.1 单 reader dispatcher

从顺序 `request()` 消费升级到：

```text
one reader
+ pending request map
+ notification channel
+ server-request router
```

### 16.2 显式 timeout

至少对：

```text
spawn/init timeout
request timeout
turn idle timeout
close timeout
```

分别定义策略。

### 16.3 Runtime Supervisor

process-per-turn 简单、安全、易回收，但启动成本高。

未来长连接模式可引入：

```text
RuntimeSupervisor
  ├─ connection health
  ├─ pending requests
  ├─ thread sessions
  ├─ restart policy
  └─ graceful shutdown
```

但只有在性能数据证明 process-per-turn 成为瓶颈后再引入。

---

## 17. 调试路径

遇到“没有流式输出”时按顺序检查：

```text
1. child 是否成功 spawn
2. stderr 是否已有错误
3. initialize response 是否成功
4. thread/start|resume 是否返回 thread id
5. turn/start response 是否成功
6. turnResult.notifications 是否已有 delta
7. nextNotification 是否继续收到消息
8. 是否真的出现 item/agentMessage/delta
9. map/normalize 是否丢掉事件
10. finally 是否过早 close
```

不要一开始就看 React。

如果 Runtime 根本没有 delta，前端不可能“优化”出真流式。

---

## 18. 复习检查表

- [ ] 能解释为什么用 `spawn()` 而不是一次性 `exec()`。
- [ ] 能解释为什么 stdout chunk 不能直接当 JSON message。
- [ ] 能区分 Request / Response / Notification / Server Request。
- [ ] 能解释 request id correlation 的必要性。
- [ ] 能指出当前连接为什么还不是完整并发 dispatcher。
- [ ] 能解释 initialize / initialized 是状态机而不是礼貌握手。
- [ ] 能说明 mapper 为什么属于安全边界。
- [ ] 能解释 delta 与 completed snapshot 的职责差异。
- [ ] 能区分 generation guard 与真正 Abort。
- [ ] 能解释 `finally` 为什么是 Runtime 正确性的核心。
- [ ] 能说出 child process close 需要哪些 timeout/fallback。
- [ ] 能解释 typed error 比字符串错误更适合跨层传播。
- [ ] 能解释 AsyncGenerator 提供什么 backpressure，又不提供什么。

---

## 19. 思考题

1. 如果同一个 App Server connection 上同时运行两个 turn，当前 `request()` 会有什么并发风险？
2. 如果 `item/completed` 文本与所有 delta 拼接结果不同，哪一个应该成为最终状态？为什么？
3. 如果 Browser 断开连接但 server 没有收到 AbortSignal，child process 会发生什么？
4. 为什么 MCP result 应该采用 allow-list mapping，而不是 `...rawItem`？
5. Runtime Supervisor 引入后，哪些状态应该进 supervisor，哪些仍应保持 request-scoped？
6. 什么时候 process-per-turn 的简单性比长连接性能更重要？
