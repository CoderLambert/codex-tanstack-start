# TanStack Start + React Streaming：源码驱动的状态与 Hook 深挖

> 基线：`main@294ecae6`
>
> 本文从 `createServerFn → async generator → useChatController → ChatEvent Adapter → chatReducer → localStorage → ChatPage` 的真实链路提炼知识。目标不是背 Hook API，而是理解每个 API 为什么存在、何时不该用、生产环境如何使用。

---

## 1. 完整数据链路：流式 UI 不是 React 自己“流”出来的

```text
ChatInput
  ↓ onSend
useChatController.sendMessage()
  ↓
streamChat() / createServerFn
  ↓
async generator on server
  ↓
streamNormalizedChatEvents()
  ↓
ChatEvent
  ↓ for await...of
ChatStateEvent
  ↓ dispatch
chatReducer()
  ↓
ChatState
  ↓
React render
```

真正的流式成立需要每一层都保持增量语义。

任何一层如果写成：

```ts
const all = []
for await (const event of source) {
  all.push(event)
}
return all
```

那么前面的 Runtime 再流式，UI 也只能最后一次性看到结果。

### 工业级心智模型

```text
Provider streaming
≠ Transport streaming
≠ State incremental update
≠ Visual typing animation
```

四者必须区分。

---

## 2. `createServerFn`：类型安全 RPC 的价值在“边界”，不在少写一个 API Route

源码：

```ts
export const streamChat = createServerFn({ method: 'POST' })
  .validator(validateChatRequest)
  .handler(async function* ({ data }) {
    yield* streamNormalizedChatEvents(data, streamCodexTurn)
  })
```

### 定义

Server Function 让浏览器以“函数调用”的开发体验跨越 Browser/Server：

```text
client call
  ↓ framework transport
server handler
```

### 为什么这里需要 validator

TypeScript 只在编译期存在。

真实网络边界收到的是：

```text
unknown input
```

所以：

```ts
streamChat({ data })
```

即使调用方类型正确，也不能替代服务端运行时验证。

### 生产范式

每一个网络/RPC 边界默认使用：

```text
unknown
  ↓ parse / validate
trusted request type
```

不要把“前后端都用 TypeScript”误解成“网络数据天然可信”。

---

## 3. Async Generator：为什么它适合 Agent Streaming

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

### 定义

普通 async function：

```text
Promise<FinalValue>
```

Async Generator：

```text
AsyncIterable<Value>
```

也就是：

```text
0..N 个异步值
```

它非常适合：

- token/delta streaming；
- progress event；
- tool lifecycle；
- logs；
- incremental query result。

### 与 callback 的区别

Callback 风格：

```text
producer push -> consumer
```

Async iterator：

```text
consumer next() <-> producer yield
```

后者更容易表达：

- 顺序；
- 生命周期；
- `try/finally` cleanup；
- cooperative backpressure。

---

## 4. `useReducer`：为什么它比一堆 `useState` 更适合 Agent UI

当前：

```ts
const [state, dispatch] = useReducer(chatReducer, initialChatState)
```

状态：

```ts
interface ChatState {
  threadId: string | null
  messages: ChatMessage[]
  activities: AgentActivity[]
  status: 'idle' | 'running' | 'error'
  error: string | null
}
```

### 定义

Reducer：

```text
State + Action -> Next State
```

### 为什么适合流式 Agent

这里的状态不是几个互不相关的值，而是一个状态机：

```text
Idle
  ↓ turn.started
Running
  ├─ thread.started
  ├─ assistant.started
  ├─ assistant.delta × N
  ├─ activity.*
  ├─ assistant.completed
  └─ turn.completed / error
```

如果拆成：

```ts
setMessages(...)
setStatus(...)
setActivities(...)
setError(...)
```

很容易出现中间非法状态，例如：

```text
status = idle
但 activity 仍 running
```

Reducer 把跨字段不变量放到同一个 transition 中。

### 工业级范式

当出现以下信号时优先考虑 reducer/state machine：

```text
多个 state 总是一起变化
存在明确 event vocabulary
存在状态转换规则
需要 event replay / test
```

不要因为“代码看起来复杂”就机械使用 reducer；简单独立表单字段继续 `useState` 更清晰。

---

## 5. Reducer 纯度：为什么 `Date.now()` 是真实的生产问题

当前 reducer 的 fallback 仍存在：

```ts
createdAt: Date.now()
```

### 纯函数定义

理想 reducer：

```text
same state + same action
       ↓
same next state
```

`Date.now()` 破坏这一点。

### 为什么影响生产，而不是代码洁癖

确定性 reducer 支持：

- 单元测试；
- event replay；
- bug reproduction；
- time-travel；
- SSR/debug；
- 从 Redux/Zustand/XState 迁移。

如果 replay 同一个事件得到不同 timestamp，状态就不是事件的确定性投影。

### 正确模式

副作用层先产生事实：

```ts
const receivedAt = Date.now()
```

再传入：

```ts
{
  type: 'assistant.delta',
  receivedAt,
  ...
}
```

Reducer 只消费。

> Reducer 应转换事实，不应创造事实。

---

## 6. `useEffect`：核心不是“组件加载后执行”，而是同步外部系统

当前有三类 Effect。

### 6.1 同步 `stateRef`

```ts
useEffect(() => {
  stateRef.current = state
}, [state])
```

### 6.2 首次读取 localStorage

```ts
useEffect(() => {
  const storage = getBrowserStorage()
  const conversation = storage ? loadConversation(storage) : null
  // restore
  setRestored(true)
}, [])
```

### 6.3 状态变化后持久化

```ts
useEffect(() => {
  if (!restored) return
  const storage = getBrowserStorage()
  if (storage) saveConversation(storage, conversationFromState(state))
}, [restored, state.threadId, state.messages])
```

### 正确定义

Effect 用于：

```text
React state
   ↕ synchronize
external system
```

外部系统包括：

- DOM imperative API；
- network；
- subscription；
- timer；
- localStorage；
- browser API；
- third-party widget。

### 什么不该放 Effect

如果只是从 props/state 计算：

```ts
const fullName = `${firstName} ${lastName}`
```

不要：

```ts
useEffect(() => setFullName(...), [firstName, lastName])
```

这是派生状态反模式，会多一次 render，并产生同步问题。

### 工业级判断算法

```text
这是事件处理？ -> event handler
这是纯派生值？ -> render 直接计算
这是昂贵纯计算？ -> 测量后 useMemo
这是外部系统同步？ -> useEffect
```

---

## 7. `useRef`：三个完全不同的生产用途

当前项目同时展示了三种 ref 思维。

### 7.1 DOM Ref

`ChatPage`：

```ts
const scrollAnchorRef = useRef<HTMLDivElement>(null)
```

配合：

```ts
scrollAnchorRef.current?.scrollIntoView({ block: 'end' })
```

这是 imperative DOM handle。

### 7.2 Latest-value Ref

Controller：

```ts
const stateRef = useRef(state)
```

让稳定 callback 读取最新 state。

### 7.3 Mutable control token

```ts
const generationRef = useRef(0)
```

用来判断异步 stream 是否仍属于当前 conversation generation。

### Ref 的本质

```text
一个跨 render 保持 identity 的 mutable container
修改 current 不触发 render
```

因此它适合“控制数据”，不适合“UI 数据”。

如果用户界面需要因为某个值变化而更新，就应该用 state，而不是 ref。

---

## 8. `useCallback`：缓存函数引用，不缓存函数结果

当前：

```ts
const sendMessage = useCallback(async (content: string) => {
  // ...
}, [])
```

### 定义

```ts
useCallback(fn, deps)
```

返回一个在 deps 不变时保持 reference identity 的函数。

等价理解：

```ts
useMemo(() => fn, deps)
```

### 它解决什么

主要解决 identity：

```text
memoized child prop
effect dependency
external subscribe/unsubscribe handler
```

### 它不解决什么

它不会：

- 让函数内部更快；
- 避免函数执行；
- 自动减少所有 render；
- 修复 stale closure。

### 当前为什么配合 `stateRef`

空依赖 callback 捕获初始 render 的闭包。

为了读最新：

```ts
stateRef.current.status
stateRef.current.threadId
```

### 生产避坑

不要为了维持 `[]` 依赖不断把所有状态搬进 ref。

正确问题应该是：

```text
这个函数真的需要稳定 identity 吗？
```

如果答案不明确，普通函数通常更简单。

---

## 9. `useMemo`：什么时候需要，为什么当前项目不应该到处加

### 定义

```ts
const value = useMemo(
  () => expensiveCompute(input),
  [input],
)
```

缓存的是**value**。

### 两个主要用途

#### 1. 避免昂贵重复计算

```ts
const filtered = useMemo(
  () => hugeList.filter(expensivePredicate),
  [hugeList, filter],
)
```

#### 2. 稳定派生对象引用

当下游真的依赖 identity：

```ts
const contextValue = useMemo(
  () => ({ state, actions }),
  [state, actions],
)
```

### 当前项目为什么没有明显必要

例如：

```ts
conversationFromState(state)
status === 'running'
messages.length === 0
```

都很廉价。

给它们套 `useMemo`：

```text
增加代码
增加 dependency 管理
增加认知成本
性能收益近乎 0
```

### 高频 streaming 下真正的性能热点

更可能是：

```text
every token delta
  ↓ dispatch
new messages array
  ↓ React render
markdown rendering / layout
```

这时更值得评估：

- token batching；
- requestAnimationFrame flush；
- message component memoization；
- external store / selector；
- virtualization；
- markdown incremental strategy。

而不是先 memo 一个布尔表达式。

### 工业级范式

```text
correctness first
  ↓
Profiler
  ↓
identify hotspot
  ↓
useMemo/memo/selectors/batching
  ↓
measure again
```

---

## 10. Stale Closure：理解 Hook 的关键不是依赖数组，而是 Render Snapshot

React 每次 render 都创建新的作用域：

```text
Render #1 -> state A -> callback A
Render #2 -> state B -> callback B
```

如果保留 Render #1 创建的 callback，它看到的就是 A。

这就是 stale closure。

### 三种解决路线

**路线 A：正确依赖**

```ts
useCallback(() => doSomething(state), [state])
```

默认优先。

**路线 B：函数式 state update**

```ts
setState(prev => next(prev))
```

当只需要基于旧值更新时。

**路线 C：latest ref**

```ts
ref.current = state
```

当 callback identity 必须长期稳定，但逻辑要读最新值时。

Ref 是 escape hatch，不是默认答案。

---

## 11. Generation Guard：解决 stale async result，不等于 Cancel

源码：

```ts
const generation = generationRef.current

for await (const event of events) {
  if (!isCurrentChatGeneration(generation, generationRef.current)) return
  dispatch(...)
}
```

New Chat：

```ts
generationRef.current += 1
```

### 解决的问题

场景：

```text
Turn A 正在流
用户点击 New Chat
Turn A 又回来一个 delta
```

没有 guard：旧流污染新会话。

有 guard：旧 event 被丢弃。

### 它没有解决的问题

旧 Runtime 仍可能继续运行。

所以：

```text
generation guard = stale result suppression
AbortController = work cancellation
```

生产 Agent UI 最终通常两个都要。

---

## 12. 持久化：为什么只保存 `threadId + messages`

`conversationFromState()`：

```ts
return {
  threadId: state.threadId,
  messages: state.messages,
}
```

没有存：

```text
activities
status
error
```

### 原则

区分：

```text
Durable product state
vs
Ephemeral runtime state
```

刷新后 `running=true` 没有意义，因为旧浏览器进程已经不存在。

### Version Envelope

```ts
{
  version: 1,
  conversation
}
```

这是生产必备思想：客户端持久化也是 schema，需要迁移策略。

### Runtime validation

读取 storage 后逐字段检查：

```text
JSON parse
version
conversation object
threadId type
messages array
message fields
```

因为 localStorage 也属于不可信输入：

- 旧版本；
- 用户手工改；
- extension 修改；
- 数据损坏。

---

## 13. SSR Awareness：`window` 不是永远存在

源码：

```ts
export function getBrowserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  // ...
}
```

TanStack Start 是全栈/SSR 环境。

React 文件能被服务端执行，并不意味着：

```text
window
localStorage
document
```

永远存在。

### 工业级原则

Browser API 必须显式位于：

```text
client event handler
useEffect
browser guard
client-only module
```

之一。

---

## 14. DOM Effect：自动滚动为什么属于 `useEffect`

`ChatPage`：

```ts
useEffect(() => {
  scrollAnchorRef.current?.scrollIntoView({ block: 'end' })
}, [messages, activities, status])
```

这是正确 Effect 类型：React render 完成后同步真实 DOM scroll position。

### 生产风险

流式 delta 高频时，这段 Effect 可能每个 token 都触发滚动，导致：

- layout thrashing；
- 用户手动向上阅读被强制拉回底部；
- 移动端性能下降。

### 工业级范式

成熟聊天 UI 通常需要：

```text
用户是否在底部附近？
  yes -> auto scroll
  no  -> 保持当前位置 + 显示“回到底部”
```

并可通过 rAF/throttle 限制滚动频率。

---

## 15. Immutable Update：正确性与成本模型要同时理解

Reducer 中：

```ts
const messages = [...state.messages]
messages[index] = {
  ...message,
  content: message.content + event.delta,
}
```

### 为什么要新引用

React 的更新判断依赖 reference identity。

直接：

```ts
state.messages[index].content += delta
return state
```

会破坏 immutable state 契约，并让调试和 memoization 失效。

### 但高频 delta 的成本

每个 token 都：

```text
复制 messages array
创建 message object
字符串 concat
React render
DOM/Markdown update
```

小规模 V0 足够，但长会话可能成为热点。

### 演进路线

不要先手写复杂 mutable store。按证据升级：

```text
1. measure
2. batch delta
3. isolate current streaming message
4. memo child messages
5. selector/external store if needed
6. virtualize long history
```

---

## 16. `ChatEvent → ChatStateEvent`：Adapter 不是重复类型

Transport：

```text
服务器允许发送什么？
```

State Event：

```text
Reducer 需要什么才能更新？
```

例如：

```text
assistant.started transport
{id}

assistant.started state
{id, createdAt}
```

Adapter 在客户端补 `receivedAt`。

### 为什么不合并

因为网络模型、领域模型、状态模型的变化原因不同。

如果为了少一个类型把它们合并，就把三个变化轴重新耦合。

这属于经典 Anti-Corruption Layer。

---

## 17. Error Handling：错误也是状态机事件

Controller catch：

```ts
catch (error) {
  dispatch({
    type: 'event.received',
    event: {
      type: 'error',
      message: ...,
    },
  })
}
```

Reducer：

```text
running -> error
```

### 为什么比 `console.error` 更正确

错误必须进入产品状态，UI 才能：

- 显示；
- retry；
- disable/enable input；
- persist diagnostics id；
- recovery。

但详细 Runtime error 不应该直接进 Browser，因此 Server Function 先做 sanitization。

---

## 18. 工业级 Hook 选择算法

遇到一个需求，可以按下面顺序判断：

```text
需要渲染它吗？
  yes -> state / reducer
  no
  ↓
需要跨 render 保存 mutable value 吗？
  yes -> ref
  no
  ↓
是纯派生计算吗？
  yes -> render 直接计算
        昂贵且已测量？ -> useMemo
  no
  ↓
是在响应用户事件吗？
  yes -> event handler
  no
  ↓
是在同步外部系统吗？
  yes -> useEffect
```

函数是否需要 `useCallback` 再独立问：

```text
是否有明确的 reference identity 消费者？
```

没有就不要默认加。

---

## 19. 调试路径

### UI 不更新

```text
ChatEvent 是否到达？
↓
toChatStateEvent 是否映射？
↓
Reducer 是否产生新引用？
↓
组件是否读取了正确字段？
```

### UI 最后一次性更新

```text
Runtime 是否有 delta？
↓
Server async generator 是否逐条 yield？
↓
RPC 是否保留 AsyncIterable？
↓
Controller 是否 for await 逐条 dispatch？
```

### New Chat 后出现旧消息

```text
generation 是否增加？
旧 stream 是否检查 generation？
是否还需要真正 Abort？
```

### 刷新丢历史

```text
restore effect
storage key/version
runtime validation
persist effect deps
threadId/messages 是否真的写入
```

---

## 20. 复习检查表

- [ ] 能解释 Server Function 为什么仍需要 runtime validation。
- [ ] 能说明 AsyncGenerator 与普通 Promise 的语义差异。
- [ ] 能说明 `useReducer` 为什么适合流式状态机。
- [ ] 能解释 reducer 内 `Date.now()` 的问题。
- [ ] 能说清 `useEffect` 的“同步外部系统”定义。
- [ ] 能区分 DOM ref、latest-value ref、generation ref。
- [ ] 能解释 `useCallback` 缓存函数引用，不缓存结果。
- [ ] 能解释 stale closure 的 Render Snapshot 根因。
- [ ] 能说出 `useMemo` 的两个合理使用场景。
- [ ] 能说明为什么不能用 `useMemo` 修复业务正确性。
- [ ] 能区分 generation guard 与 Abort。
- [ ] 能解释 localStorage 为什么也需要 schema validation。
- [ ] 能解释 SSR 环境为什么不能随便读取 `window`。
- [ ] 能分析 token delta 高频 render 的成本模型。

---

## 21. 思考题

1. 如果把 `sendMessage` 的 `useCallback([])` 删除，当前代码一定会变慢吗？如何证明？
2. 如果把 `stateRef` 去掉，应怎样改 dependency 才能保持逻辑正确？
3. `useMemo(() => messages, [messages])` 有价值吗？为什么？
4. 如果 assistant 每秒产生 100 个 delta，最优先测量哪个阶段？
5. 如果 localStorage schema 升到 v2，你会采用丢弃、迁移还是双读？选择依据是什么？
6. 如果将 reducer 改成 XState，哪些 application event contract 可以原样保留？
