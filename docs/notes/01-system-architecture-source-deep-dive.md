# Codex + TanStack Start：源码驱动的系统架构深挖

> 基线：`main@294ecae6`
>
> 本文不是对 `01-system-architecture.md` 的简单扩写，而是从真实源码出发，把架构概念还原成工程决策。统一学习模板：**源码位置 → 为什么需要 → 概念定义 → 当前实现 → 生产风险 → 工业级范式 → 复习检查**。

---

## 1. 从源码而不是目录树建立系统边界

关键调用链：

```text
src/features/chat/components/chat-page.tsx
        ↓ UI event
src/features/chat/use-chat-controller.ts
        ↓ streamChat()
src/server-functions/chat.ts
        ↓ server-only seam
src/server-functions/chat.runtime.server.ts
        ↓
src/server-functions/chat-stream.ts
        ↓ CodexRuntime
src/server/codex/codex-app-server.server.ts
        ↓ stdio JSON messages
codex app-server
```

响应反向经过：

```text
Codex notification
  ↓
CodexThreadEvent
  ↓ normalize
ChatEvent
  ↓ adapt
ChatStateEvent
  ↓ reduce
ChatState
  ↓ render
React UI
```

这条链路说明本项目真正的架构单元不是“前端 / 后端”两个盒子，而是五种不同责任：

1. **Presentation**：React 只展示应用状态。
2. **Orchestration**：Controller 管理异步副作用与生命周期。
3. **Application Contract**：`ChatEvent` 定义浏览器允许理解什么。
4. **Runtime Adapter**：`CodexRuntime` 隔离供应商协议。
5. **Infrastructure**：child process、stdio、本地认证、workspace。

### 为什么要这样分

因为这五层的变化频率不同：

```text
UI 改版             高频
React 状态结构        中频
产品事件语义          中低频
Codex 协议            外部变化
进程 / OS / 认证      基础设施变化
```

如果把它们直接揉在一起，任何一层变化都会向上扩散。

### 工业级判断

一个架构边界是否合理，不看文件夹名字，而看：

```text
这一层是否只依赖比自己更稳定的抽象？
这一层是否只暴露下游真正需要的语义？
外部供应商变化是否能被限制在局部？
```

---

## 2. Browser / Server / Runtime：这是信任边界，不只是部署边界

### 源码

`src/server-functions/chat.ts`：

```ts
export const streamChat = createServerFn({ method: 'POST' })
  .validator(validateChatRequest)
  .handler(async function* ({ data }) {
    try {
      yield* streamNormalizedChatEvents(data, streamCodexTurn)
    } catch (error) {
      console.error('Codex chat stream failed', error)
      yield {
        type: 'error' as const,
        message: 'Codex turn failed. Check the server logs for details.',
      }
    }
  })
```

这里最重要的不是 `createServerFn` 的语法，而是：

```text
Browser 可以 import 函数形状
≠
Browser 可以执行 Runtime 实现
```

真实的 Codex 逻辑继续放在 `*.server.ts` 和 `src/server/codex/**` 中。

### 为什么需要 server-only seam

Runtime 依赖：

- `node:child_process`
- `node:readline`
- 本机工作区路径
- 本地 Codex 登录态
- stdin/stdout/stderr
- 原始 Agent event

这些都不属于浏览器信任域。

如果直接让 client graph 依赖 Runtime：

```text
最轻：浏览器构建报 Node API 错误
中等：bundle 泄漏内部实现和路径
最重：原始协议、认证信息或工具结果越过安全边界
```

### 工业级范式

```text
Client-importable RPC declaration
        ↓
Server-only integration seam
        ↓
Infrastructure adapter
```

不要仅依赖“团队约定不要 import”，而要通过文件边界、构建规则和测试使违规 import 尽早失败。

---

## 3. `CodexRuntime`：依赖倒置真正发生的位置

Runtime 抽象本质上是：

```ts
interface CodexRuntime {
  streamTurn(input: StreamCodexTurnInput): AsyncGenerator<CodexThreadEvent>
}
```

### 定义

这是典型的 **Port / Adapter** 设计：

```text
Application owns the port
Infrastructure implements the adapter
```

应用只要求：

```text
给我一个 turn 的事件流
```

而不要求：

```text
必须 spawn codex
必须使用 JSON-RPC
必须经 stdio
必须叫 item/agentMessage/delta
```

### 为什么重要

未来 Runtime 可以变成：

```text
CodexAppServerRuntime ─┐
ClaudeRuntime          ├─> CodexRuntime-like application port
PiRuntime              ┤
RemoteRuntime          ┘
```

真正可替换的前提不是“以后再重构”，而是现在 UI 和 Application 层没有偷偷依赖供应商 shape。

### 生产避坑

接口过薄也可能失去语义。如果未来需要：

- interrupt
- resume
- history read
- capability negotiation
- approval
- multi-agent

不要不断给 `streamTurn()` 塞可选参数。更好的方向是把 Runtime 能力显式建模：

```text
ThreadPort
TurnPort
InterruptPort
HistoryPort
CapabilityPort
```

按真实演进拆分，而不是提前设计一个巨型接口。

---

## 4. `ChatEvent`：application-owned contract 为什么是架构核心

### 错误方案

如果 React 直接写：

```ts
if (event.method === 'item/agentMessage/delta') {
  // update UI
}
```

前端就已经绑定 Codex。

协议一旦改名、加层级、换 Runtime，UI 全部跟着变化。

### 当前设计

```text
Codex protocol
   ↓ Runtime mapping
CodexThreadEvent
   ↓ normalizer
ChatEvent
   ↓ client adapter
ChatStateEvent
   ↓ reducer
ChatState
```

这其实连续建立了两层 Anti-Corruption Layer。

### `ChatEvent` 的三个职责

**1. 稳定应用语义**

```text
assistant.started
assistant.delta
assistant.completed
activity.started
turn.completed
error
```

这些是产品语义，不是供应商语义。

**2. 数据最小化**

浏览器不需要看到：

- reasoning 原文
- command 全量 stdout/stderr
- MCP 原始 arguments/result
- 本地路径
- 子进程错误细节

**3. 兼容多 Runtime**

多个 Provider 只需要各自归一化成同一 `ChatEvent`。

### 工业级范式

Application contract 应遵守：

```text
最小
稳定
可版本化
可测试
默认不暴露敏感字段
不携带供应商特有对象
```

不要把“第三方 event type 原样拷贝一份 TypeScript union”误认为 application contract。

---

## 5. Thread / Turn / Item：领域模型必须与 UI Message 分离

正确关系：

```text
Thread
├── Turn
│   ├── reasoning item
│   ├── command item
│   ├── tool item
│   └── agentMessage item
└── Turn
```

而 React 常见的数据结构是：

```text
messages[]
```

二者不是一回事。

### 为什么不能把 Thread 当 `Message[]`

因为一个 Turn 以后可能包含：

- 0 个或多个 assistant message
- 多个 tool activity
- interrupted 状态
- usage
- approval
- files changed
- runtime error

所以：

```text
Message = UI projection
Turn = Agent work lifecycle
Thread = Long-lived Agent context
```

### 生产价值

提前分清以后，做下面功能时不会推翻模型：

```text
Stop / Interrupt
Retry turn
Branch conversation
Tool timeline
Replay
Multi-agent handoff
Thread history
```

---

## 6. Controller / Reducer / UI：副作用与确定性状态的分层

当前：

```text
useChatController
  - RPC
  - Date.now()
  - localStorage
  - async iterator
  - generation guard

chatReducer
  - state + action -> next state

ChatPage
  - render + DOM effect
```

这是比“组件拆小”更重要的分层。

### `useReducer` 为什么适合这里

流式 Agent UI 是一个事件驱动状态机：

```text
idle
 ↓ turn.started
running
 ├─ assistant.started
 ├─ assistant.delta × N
 ├─ activity.*
 └─ turn.completed / error
```

如果全部用分散 `setState`：

```text
setMessages
setStatus
setError
setActivities
setThreadId
```

跨状态不变量很难集中维护。

Reducer 则把状态变化变成显式 event transition。

### 当前值得修正的源码反例

`chat.reducer.ts` 的 fallback 分支仍直接执行：

```ts
createdAt: Date.now()
```

这意味着 reducer 不再完全确定：

```text
same state + same action
可能得到不同 result
```

更好的设计是让 adapter/controller 在 reducer 外注入时间。

### 原则

> Reducer 只转换事实，不创造事实。

时间、随机 ID、网络、storage、日志都属于 reducer 外部。

---

## 7. `useCallback`、`useRef`、闭包：不要把性能 API 与正确性混为一谈

`useChatController()` 当前：

```ts
const stateRef = useRef(state)

useEffect(() => {
  stateRef.current = state
}, [state])

const sendMessage = useCallback(async (content: string) => {
  if (stateRef.current.status === 'running') return
  // ...
}, [])
```

### `useCallback` 的定义

它缓存的是：

```text
function identity
```

不是函数执行结果。

它真正有价值的场景通常是：

- callback 传给 memoized child
- callback 作为其它 Hook dependency
- 外部系统要求稳定 handler identity

不是“所有函数都包一下性能更好”。

### 为什么这里需要理解 stale closure

空依赖 callback 会捕获首次 render 的值。

所以代码没有直接读：

```ts
state.status
```

而是读：

```ts
stateRef.current.status
```

这是典型 latest-value ref 模式。

### 风险

当越来越多状态被塞进 `stateRef.current`，代码会绕开 React dependency model。

工业级判断：

```text
先问 callback 为什么必须稳定
如果没有明确消费者要求稳定
优先使用普通函数/正确依赖
不要为了 [] 依赖而引入一堆 ref
```

---

## 8. `useMemo`：为什么当前项目没有强行使用反而是正确的

### 定义

```ts
const value = useMemo(() => compute(input), [input])
```

它缓存的是**计算结果**。

主要解决：

1. 昂贵纯计算重复执行；
2. 下游依赖 value reference identity。

### 它不是什么

`useMemo` 不是：

- 业务正确性机制
- 永久缓存
- 所有派生值的默认写法
- 自动让代码更快的开关

例如：

```ts
const isRunning = status === 'running'
```

没有理由写成：

```ts
const isRunning = useMemo(() => status === 'running', [status])
```

memo 本身也有 dependency tracking 和 cache 管理成本。

### 工业级范式

```text
先写直接纯计算
     ↓
Profiler / measurement
     ↓
确认热点或引用稳定问题
     ↓
局部 useMemo
     ↓
再次测量
```

对于本项目，更值得先关注的是高频 token delta 触发的整体 render 次数，而不是对廉价派生值做微优化。

---

## 9. 持久化边界：UI transcript 不是 Agent truth

`chat.storage.ts` 只持久化：

```ts
{
  threadId,
  messages,
}
```

没有持久化：

```text
status
activities
error
runtime process
raw events
```

这是正确的最小持久化边界。

### 为什么

刷新后真正需要恢复的是：

```text
用户可见 transcript
+
继续连接 Runtime thread 的 threadId
```

而 `running/error/activity` 属于瞬时状态。

### 版本 envelope

源码使用：

```ts
{
  version: CHAT_STORAGE_VERSION,
  conversation
}
```

这是一个很值得保留的生产范式。任何长期客户端持久化都应默认考虑 schema evolution，而不是直接 `JSON.stringify(state)`。

---

## 10. V0 read-only：安全必须是组合属性

Runtime 固定：

```text
approvalPolicy: never
sandbox: read-only
networkAccess: false
```

Workspace 还通过：

```text
realpath
relative
allowedRoot
```

把浏览器提交的路径限制在允许根目录内。

Server Function 最后又做错误脱敏：

```text
server log = 详细错误
browser event = 通用错误信息
```

因此安全不是一个 `readOnly=true`：

```text
Capability restriction
+ Path confinement
+ No interactive escalation
+ Data minimization
+ Error sanitization
```

### 工业级原则

> Agent execution security 与 data exposure security 是两条独立边界。

Sandbox 防止 Agent 做危险事；Application Contract 防止敏感数据进入浏览器。缺一不可。

---

## 11. 调试路径：永远沿边界定位，不要从 UI 猜 Runtime

推荐顺序：

```text
1. UI 是否触发 sendMessage
2. Controller 是否 dispatch turn.started
3. ServerFn validator 是否通过
4. streamTurn 是否启动
5. app-server initialize 是否成功
6. thread/start 或 resume 是否成功
7. turn/start 是否成功
8. 是否收到 item/agentMessage/delta
9. normalizer 是否产出 ChatEvent
10. adapter 是否产出 ChatStateEvent
11. reducer 是否正确 fold
12. UI 是否正确 render
```

对每一层只问两个问题：

```text
输入是什么？
输出是什么？
```

这比“多打几个 console.log”更容易形成可重复的排障方法。

---

## 12. 架构演进方向

当前 V0 可以自然演进为：

```text
V0 process-per-turn + read-only
        ↓
显式 Abort / interrupt
        ↓
长连接 Runtime supervisor
        ↓
结构化 Tool/Command timeline
        ↓
server-side durable conversation store
        ↓
multi-runtime adapter
        ↓
capability negotiation / approval policy
        ↓
multi-agent orchestration
```

演进时应守住三条不变量：

1. Browser 不理解供应商原始协议。
2. Application event contract 由应用自己拥有。
3. Runtime 权限永远由服务端决定。

---

## 13. 复习检查表

- [ ] 能画出 Browser → ServerFn → Runtime → app-server → Event → Reducer 的完整链路。
- [ ] 能解释 `*.server.ts` 为什么是信任边界。
- [ ] 能区分 Thread、Turn、Item、UI Message。
- [ ] 能解释 `CodexRuntime` 为什么是 Port，而 `CodexAppServerRuntime` 是 Adapter。
- [ ] 能解释 `ChatEvent` 为什么不能等于 Codex 原始 event。
- [ ] 能区分 Transport Contract 与 State Contract。
- [ ] 能说明 reducer 为什么不应调用 `Date.now()`。
- [ ] 能解释 `useCallback` 缓存 function identity，而 `useMemo` 缓存 value。
- [ ] 能说明 latest-value ref 的价值与代价。
- [ ] 能解释 browser transcript 为什么不是 Agent thread truth。
- [ ] 能说明 read-only sandbox 与数据脱敏为什么是两条安全线。
- [ ] 能沿完整链路定位“UI 不流式”的故障层。

---

## 14. 思考题

1. 如果把 `ChatEvent` 删除，让 React 直接消费 `CodexThreadEvent`，第一年和第三年的维护成本分别会发生什么？
2. 如果未来一个 Turn 同时有两个 assistant item，当前 `messages[]` 模型是否仍然成立？
3. `generationRef` 能阻止旧流污染 UI，但为什么它不等价于真正的 Runtime cancel？
4. 如果 Runtime 从 process-per-turn 改成长连接 supervisor，哪些边界应保持完全不变？
5. 如果要开放文件写入，除了把 sandbox 改成 writable，还需要新增哪些 capability、approval、audit 和 UI 边界？
6. 什么证据出现时，你才会在本项目里引入 `useMemo`？
