# Codex + TanStack Start：源码驱动的架构知识点深挖

> 本文是 `01-system-architecture.md` 的源码型补充。目标不是再讲一遍项目结构，而是把真实源码中出现的 React、状态机、流式 RPC、事件契约与 server-only 设计提炼成可迁移的工程知识。
>
> 学习方法统一采用：**源码位置 → 为什么需要 → API/概念定义 → 当前实现 → 生产风险 → 工业级范式 → 复习检查**。

---

## 1. 先从源码建立知识地图

当前关键链路：

```text
src/features/chat/components/chat-page.tsx
        ↓ render
src/features/chat/use-chat-controller.ts
        ↓ streamChat()
src/server-functions/chat.ts
        ↓ async generator
src/server-functions/chat-stream.ts
        ↓ normalize
src/features/chat/chat-event.adapter.ts
        ↓ ChatStateEvent
src/features/chat/chat.reducer.ts
        ↓ ChatState
React render
```

这条链路里至少包含七类可迁移知识：

1. `useReducer` 与显式状态机；
2. `useCallback`、闭包与函数引用稳定性；
3. `useRef` 与 mutable escape hatch；
4. `useEffect` 与“外部系统同步”；
5. `useMemo` 的正确定位，以及为什么当前项目没有必要为了“优化”强行加入；
6. async generator / `for await...of` 与真正的 streaming；
7. application-owned event contract、Anti-Corruption Layer 与 server-only boundary。

这些知识不能只记 API 签名。真正需要掌握的是：**它解决了什么问题、什么时候不该用、生产环境里如何避免把局部技巧升级成架构债务。**

---

# 2. `useReducer`：不是“另一种 useState”，而是显式状态转换模型

源码：

```text
src/features/chat/use-chat-controller.ts
src/features/chat/chat.reducer.ts
```

Controller 初始化：

```ts
const [state, dispatch] = useReducer(chatReducer, initialChatState)
```

## 2.1 定义

`useReducer(reducer, initialArg)` 把状态更新表达为：

```text
State + Action -> Next State
```

Reducer 的理想性质：

```text
相同 state + 相同 action
          ↓
相同 nextState
```

也就是确定性纯函数。

## 2.2 为什么这个项目适合 `useReducer`

聊天不是一个布尔值或输入框，而是多个生命周期共同组成的状态机：

```text
idle
  ↓ turn.started
running
  ├─ assistant.started
  ├─ assistant.delta × N
  ├─ activity.started/updated/completed
  ↓ turn.completed
idle

running
  ↓ error
error
```

如果用大量独立 `setState`：

```ts
setMessages(...)
setStatus(...)
setActivities(...)
setError(...)
```

状态转移会分散到多个 callback/effect 中，难以回答：

> 收到某个事件后，整个 ChatState 究竟如何变化？

Reducer 把答案集中在一个地方。

## 2.3 当前源码值得学习的点：事件驱动，而不是 UI 驱动

当前 action 不是：

```text
showSpinner
hideSpinner
appendText
```

而是：

```text
turn.started
assistant.started
assistant.delta
assistant.completed
error
```

前者描述“UI 要怎么变”；后者描述“领域里发生了什么”。

工业级状态建模优先：

```text
Domain Event -> State Transition -> UI Projection
```

而不是：

```text
UI Operation -> mutate state
```

## 2.4 当前源码中的生产级风险：Reducer 内部 `Date.now()`

`assistant.delta` 与 `assistant.completed` 的 fallback 路径仍存在：

```ts
createdAt: Date.now()
```

这意味着 reducer 并非完全确定：

```ts
reducer(state, action) !== reducer(state, action)
```

在不同时间执行可能得到不同结果。

### 为什么这是实际工程问题

它会削弱：

- event replay；
- snapshot test；
- time-travel debugging；
- SSR/并发调试可预测性；
- 状态恢复与问题复现能力。

### 工业级范式

把时间、随机数、网络结果等非确定数据全部在 reducer 外生成：

```ts
const event = {
  type: 'assistant.delta',
  id,
  delta,
  receivedAt: Date.now(),
}

dispatch({ type: 'event.received', event })
```

Reducer 只消费事件：

```ts
createdAt: event.receivedAt
```

原则：

> **Reducer 只做转换，不创造事实。**

---

# 3. `useCallback`：缓存的不是“执行结果”，而是函数引用

源码：

```text
src/features/chat/use-chat-controller.ts
```

当前：

```ts
const sendMessage = useCallback(async (content: string) => {
  ...
}, [])

const newChat = useCallback(() => {
  ...
}, [])
```

## 3.1 定义

`useCallback(fn, deps)` 可以近似理解为：

```ts
useMemo(() => fn, deps)
```

它缓存的是 **function identity**，不是函数运行后的值。

```text
render 1 -> function A
render 2 -> function A   // deps 未变化
render 3 -> function B   // deps 变化
```

## 3.2 为什么会需要稳定函数引用

常见场景：

- callback 传给 `memo` 子组件；
- callback 是其他 Hook 的 dependency；
- callback 被事件订阅 API 注册/注销；
- 需要对外暴露长期稳定的 controller API。

当前 `ChatController` 返回：

```ts
return { state, sendMessage, newChat }
```

让命令函数保持稳定，可以避免依赖方仅因为函数 identity 变化而重复工作。

## 3.3 生产避坑：`useCallback([])` 会冻结闭包

如果直接写：

```ts
const sendMessage = useCallback(() => {
  console.log(state.threadId)
}, [])
```

这里看到的是首次 render 的 `state`。

这就是 stale closure。

当前源码通过：

```ts
const stateRef = useRef(state)

useEffect(() => {
  stateRef.current = state
}, [state])
```

再读取：

```ts
stateRef.current.threadId
stateRef.current.status
```

规避旧闭包。

## 3.4 工业级判断顺序

不要形成“函数都包 useCallback”的习惯。

先问：

```text
1. 这个函数引用真的需要稳定吗？
2. 下游是否依赖 reference equality？
3. 是否因此减少了实际渲染/订阅工作？
4. 为了保持稳定引用，是否引入了 stateRef 等额外复杂度？
```

如果答案只是“可能更快”，通常不应该加。

### 典型反模式

```ts
const handleClick = useCallback(() => {
  setCount((c) => c + 1)
}, [])
```

如果它只直接挂在普通 `<button>` 上，并没有 memoized child 或依赖稳定引用的订阅关系，收益通常接近零。

原则：

> **`useCallback` 是 identity 工具，不是默认性能开关。**

---

# 4. `useRef`：跨 render 保存可变值，但不触发 render

当前有三个典型用途：

```ts
const stateRef = useRef(state)
const generationRef = useRef(0)
const scrollAnchorRef = useRef<HTMLDivElement>(null)
```

它们实际上代表三种完全不同的 `ref` 用法。

## 4.1 DOM ref

`chat-page.tsx`：

```ts
const scrollAnchorRef = useRef<HTMLDivElement>(null)
```

用途：持有 DOM 节点引用。

这是 React 官方最标准的 ref 场景之一：

```text
React render tree
     ↓
DOM node imperative API
```

例如：

```ts
scrollAnchorRef.current?.scrollIntoView()
```

## 4.2 latest-value ref

```ts
stateRef.current = state
```

用于稳定 callback 中读取最新值。

本质上是：

```text
stable function
    ↓
mutable box
    ↓
latest state
```

这种模式有效，但属于 escape hatch。

如果大量业务状态都必须通过 `xxxRef.current` 访问，说明组件的数据流可能已经过度绕开 React。

## 4.3 generation token

```ts
const generationRef = useRef(0)
```

新会话时：

```ts
generationRef.current += 1
```

旧 stream 每次收到事件都检查：

```ts
if (!isCurrentChatGeneration(generation, generationRef.current)) return
```

这解决的是：

> New Chat 之后，旧异步流不能继续污染新会话。

它本质上是一个 logical cancellation token。

## 4.4 但 generation guard 不等于真正取消

它只做到：

```text
旧结果不再进入状态
```

并没有保证：

```text
旧 HTTP 请求停止
Codex turn 停止
子进程停止
server generator 停止
```

工业级系统通常需要区分：

```text
Ignore stale result
        vs
Cancel underlying work
```

后续演进可以考虑 `AbortSignal` / runtime cancel protocol。

---

# 5. `useEffect`：用于同步外部系统，而不是承载业务流程

当前 `useEffect` 有三个真实案例。

## 5.1 同步 latest state 到 ref

```ts
useEffect(() => {
  stateRef.current = state
}, [state])
```

这里同步的是 React state 与 mutable ref。

## 5.2 从 browser storage 恢复会话

```ts
useEffect(() => {
  const storage = getBrowserStorage()
  ...
}, [])
```

localStorage 属于 React 外部系统，因此 Effect 合理。

## 5.3 把状态持久化到 storage

```ts
useEffect(() => {
  if (!restored) return
  ...
}, [restored, state.threadId, state.messages])
```

这也是典型：

```text
React state -> external persistence
```

## 5.4 为什么不应该“有变化就写 Effect”

错误思维：

```text
A 变了
  ↓ useEffect
算 B
  ↓ setState
触发下一次 render
```

如果 B 可以纯计算得到：

```ts
const b = derive(a)
```

就不应该先存一份再 Effect 同步。

工业级判断：

```text
能在 render 中纯计算？ -> 直接计算
需要昂贵缓存？         -> 考虑 useMemo
需要同步外部系统？      -> useEffect
响应用户事件？          -> event handler
```

---

# 6. `useMemo`：当前源码没用，反而是一个很好的教学点

当前主链路没有 `useMemo`。这不是“缺了优化”，而是说明：

> **没有明确成本，就不应该为了看起来专业而增加 memoization。**

## 6.1 定义

`useMemo(factory, deps)` 缓存的是计算结果：

```ts
const value = useMemo(() => expensiveCompute(input), [input])
```

近似心智模型：

```text
deps 未变化 -> 复用上一次 value
 deps 变化   -> 重新执行 factory
```

## 6.2 它真正解决什么

主要有两类用途。

### A. 避免高成本重复计算

例如未来需要从数千条 activity 中构建分组：

```ts
const groupedActivities = useMemo(
  () => buildActivityTree(activities),
  [activities],
)
```

前提：`buildActivityTree()` 确实昂贵，并且 profiling 证明值得缓存。

### B. 稳定派生对象引用

例如下游是 `memo` 组件：

```ts
const viewModel = useMemo(
  () => ({ messages, status }),
  [messages, status],
)
```

如果每次 render 都重新 `{}`，即使字段没变化，reference equality 也不同。

但只有下游真的依赖引用稳定性时才有价值。

## 6.3 `useMemo` 不是什么

不是：

```text
保证永远不重新计算的缓存
业务正确性工具
所有派生变量的默认写法
“用了就更快”的性能开关
```

业务代码不能依赖“useMemo 永远不丢缓存”来保证正确性。

## 6.4 生产避坑

### 反模式 1：缓存廉价计算

```ts
const fullName = useMemo(
  () => `${firstName} ${lastName}`,
  [firstName, lastName],
)
```

字符串拼接比 memo bookkeeping 更简单。

### 反模式 2：用 `useMemo` 修复逻辑错误

如果移除 `useMemo` 后程序结果错误，说明代码已经把 optimization 当成 correctness contract。

### 反模式 3：依赖不完整

```ts
const result = useMemo(() => calculate(a, b), [a])
```

`b` 改变时得到 stale value。

### 反模式 4：对象依赖每次都变

```ts
const options = { limit: 20 }
const result = useMemo(() => query(options), [options])
```

`options` 每次 render 都是新对象，memo 失效。

## 6.5 工业级范式

推荐顺序：

```text
先写正确、简单的纯计算
        ↓
React Profiler / performance measurement
        ↓
确认热点
        ↓
判断是计算成本还是引用稳定问题
        ↓
局部使用 useMemo
        ↓
再次测量
```

所以对于当前项目，**不添加 `useMemo` 比盲目添加更专业。**

---

# 7. async generator：为什么真正的 streaming 不是“拿到完整结果再 setState”

服务端：

```ts
.handler(async function* ({ data }) {
  yield* streamNormalizedChatEvents(data, streamCodexTurn)
})
```

客户端：

```ts
const events = await streamChat({ data })

for await (const event of events) {
  dispatch(...)
}
```

## 7.1 定义

Async generator 同时具备：

```text
async  -> 可以 await 异步工作
generator -> 可以多次 yield
```

因此函数结果不是一个最终值，而是一条异步序列：

```text
AsyncIterable<Event>
```

## 7.2 为什么比 callback 更适合作为这里的边界

它天然表达：

```text
producer
   ↓ yield event
consumer
   ↓ next()
producer continues
```

生命周期清晰，组合也简单：

```text
Codex stream
  ↓ normalize
ChatEvent stream
  ↓ RPC
Browser stream
```

## 7.3 最常见的“伪流式”错误

```ts
const all = []
for await (const event of source) {
  all.push(event)
}
return all
```

这样上游虽然是 streaming，下游仍然必须等全部完成。

判断一个系统是否真的流式，必须检查 **端到端每一层**。

---

# 8. Event Adapter：典型 Anti-Corruption Layer

源码：

```text
src/features/chat/chat-event.adapter.ts
```

```ts
ChatEvent -> toChatStateEvent() -> ChatStateEvent
```

这不是“多包了一层类型”。

它在做三件重要事情：

1. 阻止 transport model 直接进入 state model；
2. 在客户端注入 `receivedAt` 等本地语义；
3. 丢弃 reducer 不需要的信息。

例如：

```ts
case 'turn.completed':
  return { type: 'turn.completed' }
```

transport 可以携带 usage，但 reducer 当前不需要保存 usage。

这就是防腐层的价值：

```text
External / Transport Model
          ↓
      Adapter
          ↓
Internal State Model
```

工业级原则：

> 外部协议升级时，优先让变化停止在 Adapter，不要让变化扩散到整个 React tree。

---

# 9. Application-owned Contract：为什么前端不消费 Codex 原始事件

服务端入口：

```text
src/server-functions/chat.ts
```

这里最终只 yield 应用定义的事件，而不是任意 runtime error / Codex JSON-RPC 对象。

错误处理也明确：

```ts
console.error('Codex chat stream failed', error)

yield {
  type: 'error',
  message: 'Codex turn failed. Check the server logs for details.',
}
```

这体现两个边界。

## 9.1 协议边界

```text
Codex protocol
     ↓ normalize
ChatEvent
     ↓
Browser
```

UI 依赖自己的 application contract，而不是供应商 contract。

## 9.2 安全边界

任意 runtime error 可能包含：

- 本地路径；
- process 参数；
- command 输出；
- authentication 信息；
- provider 细节。

因此：

```text
Server logs = diagnostic detail
Browser event = sanitized product message
```

这是 production error boundary，而不是简单的 `try/catch`。

---

# 10. `*.server.ts`：模块图也是安全边界

`chat.ts` 是浏览器可 import 的 Server Function declaration：

```ts
import { streamCodexTurn } from './chat.runtime.server'
```

真正 runtime 被放进 server-only 模块。

需要建立的心智模型：

```text
同一个 TypeScript 仓库
      ≠
同一个运行环境
```

Browser 不应该拿到：

```text
child_process
stdio
~/.codex
workspace filesystem
raw runtime events
```

工业级 full-stack 项目应该把“是否允许进入 client dependency graph”当成架构问题，而不仅是文件命名习惯。

---

# 11. Immutable Update：为什么 reducer 里一直复制数组

例如：

```ts
const messages = [...state.messages]
messages[index] = {
  ...message,
  content: message.content + event.delta,
}
```

而不是：

```ts
state.messages[index].content += event.delta
return state
```

原因不只是“React 规定不能改”。

React 更新大量依赖 reference equality：

```text
oldRef === newRef
```

Immutable update 可以明确告诉系统：

```text
哪些节点变了
哪些节点没变
```

这也是未来 `memo` / selector / structural sharing 优化的基础。

### 生产注意

流式 token 很密集时，每个 delta 都复制 message array：

```text
N 个 delta -> N 次 array copy -> N 次 render opportunity
```

小规模聊天完全合理；如果未来消息量和 token 频率很高，可以评估：

- token batching；
- animation-frame flush；
- external store；
- message-level subscription；
- virtualized transcript。

不要提前优化，但要知道成本模型。

---

# 12. `assistant.completed`：最终 snapshot 是校准，不是重复数据

当前状态机同时接受：

```text
assistant.delta × N
assistant.completed(full text)
```

看起来 full text 与 delta 重复，实际上职责不同：

```text
delta      = latency / UX
completed  = authoritative final state
```

这是一种生产上很实用的协议模式：

```text
Incremental Projection + Final Reconciliation
```

它可以修复：

- 丢 delta；
- delta 顺序异常；
- 中间状态差异；
- server 端最终文本修订。

类似思想也出现在：

- optimistic UI + server response；
- event stream + snapshot；
- CDC + reconciliation；
- multiplayer prediction + authoritative server state。

---

# 13. 当前代码的生产级改进清单

这些不是必须立即修改业务代码，而是应该进入架构认知。

| 现状 | 风险 | 工业级方向 |
|---|---|---|
| reducer fallback 使用 `Date.now()` | 非确定 reducer | 时间放到 event/adapter 层 |
| generation guard | 只忽略 stale result | 后续补 Abort/cancel runtime |
| 每个 delta dispatch | 高频 render | 有性能问题后再做 batching |
| localStorage 同步写 | 大 transcript 时阻塞主线程 | IndexedDB / async persistence |
| callback 用 `stateRef` 读取最新 state | 容易逐渐绕开 React 数据流 | 控制 ref 数量，定期审查依赖 |
| Browser 保存 transcript | 只是 UI projection | 不与 Codex thread truth 混淆 |
| sanitized browser error | 可观测性较弱 | server request/turn correlation id |

---

# 14. 一套可复用的“工业级 Hook 选择算法”

遇到 React 逻辑时，不要先问“该用哪个 Hook”，先问问题属于哪一类：

```text
需要保存 UI 状态？
  -> useState / useReducer

多个事件驱动复杂状态机？
  -> useReducer

需要访问 DOM / mutable token / latest value？
  -> useRef

需要同步浏览器 API、storage、network subscription 等外部系统？
  -> useEffect

需要稳定函数 identity？
  -> useCallback

需要缓存昂贵计算或稳定派生 value identity？
  -> useMemo

只是普通纯计算？
  -> 直接计算，不要 Hook
```

这比背 Hook API 更重要。

---

# 15. 调试路径：从“页面不对”定位到真正的层

如果“消息没有正常显示”，不要直接在 React 组件里乱加日志。

按边界逐层检查：

```text
1. Codex 是否产生 item/agentMessage/delta？
2. Runtime 是否转换为内部 Codex event？
3. Normalizer 是否生成 assistant.delta？
4. createServerFn streaming 是否把事件送到 Browser？
5. toChatStateEvent 是否转换正确？
6. reducer 是否得到正确 next state？
7. ChatPage 是否只是 state 的正确投影？
```

如果“New Chat 后旧回答又回来”：

```text
generationRef 是否变化？
旧 stream 是否仍 dispatch？
是否只是 UI 忽略，server work 实际仍继续？
```

如果“刷新后历史错乱”：

```text
restore 是否先完成？
persist effect 是否过早覆盖 storage？
threadId 与 transcript 是否被错误理解成同一个 truth source？
```

架构边界清楚以后，debugging 本质就是确定“错误第一次出现在哪个 contract”。

---

# 16. 复习检查表

能独立回答以下问题，才算真正掌握当前源码：

- [ ] 为什么聊天状态用 `useReducer` 比多个 `useState` 更合适？
- [ ] Reducer 为什么应该是 deterministic pure function？
- [ ] 当前 reducer 中哪两条路径破坏了完全确定性？
- [ ] `useCallback` 缓存的是值还是函数 identity？
- [ ] 为什么 `useCallback([])` 会产生 stale closure？
- [ ] `stateRef` 解决了什么，又引入了什么架构代价？
- [ ] `generationRef` 为什么只能算 logical cancellation？
- [ ] DOM ref、latest-value ref、generation token 三者有什么区别？
- [ ] 什么逻辑应该放 `useEffect`，什么逻辑不应该？
- [ ] 当前项目为什么没有必要强行加 `useMemo`？
- [ ] `useMemo` 真正适合哪两类问题？
- [ ] async generator 为什么适合流式 RPC？
- [ ] 什么写法会把真 streaming 退化成批量响应？
- [ ] `ChatEvent -> ChatStateEvent` 为什么不是重复类型？
- [ ] application-owned contract 同时解决了解耦和什么安全问题？
- [ ] `assistant.completed` 为什么仍要携带完整 snapshot？
- [ ] 高频 delta 下 immutable update 的成本在哪里？
- [ ] `*.server.ts` 为什么是模块安全边界，而不仅是命名规范？

---

# 17. 思考题

### 题 1

如果把：

```ts
const sendMessage = useCallback(..., [])
```

改成普通函数，同时删除 `stateRef`，改为直接读取 `state`，功能一定会错吗？什么时候反而会更简单？

### 题 2

如果未来 `AgentActivity` 达到 10,000 条，需要按 `kind/status` 构建复杂树结构，应该第一时间加 `useMemo` 吗？你需要先测量什么？

### 题 3

如果用户点 New Chat 后 Codex 旧 turn 仍在后台消耗 token，为什么 generation guard 无法解决？取消协议应该落在哪一层？

### 题 4

如果把 `ChatEvent` 删除，让 Browser 直接消费 Codex JSON-RPC notification，短期少写了哪些代码？长期又会把哪些成本转嫁到 UI？

### 题 5

为什么下面代码违反 reducer 纯函数原则？

```ts
case 'message.created':
  return {
    ...state,
    createdAt: Date.now(),
  }
```

应该把 `Date.now()` 移到哪里？

### 题 6

`assistant.delta` 和 `assistant.completed(text)` 同时存在时，哪个是 UI 的“实时事实”，哪个是“最终事实”？如果两者不一致应该信谁？

---

# 18. 最终心智模型

这套源码真正值得记住的不是某几个 Hook，而是下面这条工程链：

```text
External Runtime
      ↓
Server-only Adapter
      ↓
Application-owned Event Contract
      ↓
Streaming Transport
      ↓
Client Adapter
      ↓
Deterministic State Machine
      ↓
React Projection
      ↓
External Persistence / DOM synchronization
```

React Hook 只是实现这些边界的工具。

真正的工业级能力是能够解释：

```text
为什么这个状态属于这里？
为什么这个副作用属于这里？
为什么这个协议不能继续向下泄漏？
为什么这里需要稳定引用？
为什么这里不需要 memoization？
如果规模扩大 10 倍，首先会在哪个边界出现成本？
```

能回答这些问题，才是从“会写 React”进入“能设计生产级 React/Agent 系统”的分界线。
