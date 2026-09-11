# 专业技术笔记索引

这套笔记用于长期复习 `Codex + TanStack Start` 本地 Agent 架构。它与 `docs/tasks/*`、`DEVELOPMENT_PLAN.md`、`VALIDATION.md` 的定位不同：后者记录“项目怎么做、当时做到了什么”，这里回答“为什么这样做、这些知识如何迁移到其他 Agent 工程”。

## 推荐阅读顺序

| 顺序 | 笔记 | 主要问题 | 学习目标 |
|---|---|---|---|
| 1 | [01-system-architecture.md](./01-system-architecture.md) | 系统边界在哪里？ | 建立 Browser / TanStack Start / Runtime / Codex 的整体心智模型，理解 thread / turn / item 与 application-owned event contract |
| 2 | [02-codex-app-server-streaming.md](./02-codex-app-server-streaming.md) | 真流式从哪里来？ | 掌握 app-server、stdio/JSON-RPC、`item/agentMessage/delta`、进程生命周期、安全策略与协议适配 |
| 3 | [03-tanstack-streaming-state.md](./03-tanstack-streaming-state.md) | 流式事件如何变成稳定 UI？ | 掌握 `createServerFn`、async generator、Transport/State contract、reducer 状态机、stale stream 与 persistence |
| 4 | [04-testing-reliability-security.md](./04-testing-reliability-security.md) | “能跑”为什么不等于“可靠”？ | 掌握 correlation、abort/interrupt、fake transport、child process、错误收敛、安全边界和故障注入 |
| 5 | [05-end-to-end-review.md](./05-end-to-end-review.md) | 一条消息完整经历了什么？ | 把前四篇重新串成端到端模型，并提炼可迁移的工程模式 |

## 先修知识

建议先具备以下基础，再阅读效果最好：

- TypeScript：union type、type narrowing、async iterator、`AsyncGenerator`；
- React：render/commit、state snapshot、`useReducer`、`useRef`、副作用边界；
- Node.js：`child_process.spawn`、stdio、process signal；
- Web：RPC、streaming、SSE/WebSocket 的基本区别；
- Agent：conversation/session、tool call、streaming response 的基本概念。

如果只想快速理解项目，从 **01 → 05** 即可；如果要修改 Runtime，必须完整读 **02 + 04**；如果主要维护 Web/UI，重点读 **03 + 05**。

## 统一术语

整套笔记统一采用下面的含义：

```text
Thread  = Codex 长期会话上下文
Turn    = Thread 内一次用户请求对应的一轮 Agent 执行
Item    = Turn 内部的工作单元
Delta   = Assistant 正文增量
Snapshot = 某个时刻/完成态的完整正文
ChatEvent = Server -> Browser 的应用级传输协议
ChatStateEvent = 进入 reducer 的状态事件
Runtime = 对具体 Agent 后端的适配层
```

事件命名以当前应用协议为准：

```text
thread.started
assistant.started
assistant.delta
assistant.completed
activity.started
activity.updated
activity.completed
turn.completed
error
```

Codex 原始协议只在 Runtime/协议专题中出现，例如：

```text
thread/start
thread/resume
turn/start
item/started
item/agentMessage/delta
item/completed
thread/tokenUsage/updated
turn/completed
```

不要把两组名字混用：前者是应用协议，后者是 Provider 协议。

## 阅读方法

每篇都按相同模板组织：

1. 背景与问题；
2. 心智模型；
3. 生命周期 / 数据流 / 状态机；
4. 当前源码映射；
5. 为什么这样设计；
6. 替代方案与 trade-off；
7. 失败模式；
8. 调试方法；
9. 测试策略；
10. 可迁移结论；
11. 复习题。

阅读时不要只记 API。优先回答三个问题：

```text
这层拥有什么状态？
这层信任哪些数据？
这层允许把什么信息交给下一层？
```

这三个问题比记住某个函数名更能帮助你迁移到 Claude、Pi、Qwen、OpenCode 或其他 Runtime。

## 文档分区

### 学习笔记

`docs/notes/*` 是长期维护的知识文档。要求与当前源码一致，并解释设计理由和适用边界。

### 项目记录

以下文件保留为历史/实施记录，不作为系统学习入口：

- `docs/ARCHITECTURE.md`：V0 架构摘要；
- `docs/INTEGRATION.md`：Task 05 集成记录；
- `docs/DEVELOPMENT_PLAN.md`：五任务开发拆分；
- `docs/VALIDATION.md`：某次集成验证快照；
- `docs/tasks/*`：各开发任务的实施说明。

项目记录可以保留当时的事实，但不应承担“专业知识笔记”的职责。

## 当前源码审阅重点

当前文档已经明确区分“已经实现”和“应继续完善”的内容。阅读时尤其注意：

- 真流式来自 `item/agentMessage/delta`；
- `item/completed` 的完整文本用于最终校准；
- 当前安全策略是 read-only、network disabled、approval never；
- Browser 不能收到 raw reasoning、command output、MCP 参数/result 或本地认证信息；
- `generationRef` 解决 stale UI write，但不等于真正中断底层 turn；
- Runtime 长期形态应使用 `threadId + turnId` 做 correlation；
- reducer 应保持纯函数，时间/随机数/IO 必须在 reducer 外生成；
- process-per-turn 对 V0 简单可靠，但 long-lived app-server 更适合 interrupt、steer、多 thread 和 approval。

这些“缺口”不是文档错误，而是当前实现与下一阶段工程化之间的边界。
