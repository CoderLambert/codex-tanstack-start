# Architecture

> **文档定位：V0 架构摘要 / 项目记录。** 本文保留用于快速查看当前架构边界，不承担系统教学职责。完整的架构心智模型、设计理由、替代方案、失败模式与复习内容请阅读 [`docs/notes/01-system-architecture.md`](./notes/01-system-architecture.md)；端到端串联请阅读 [`docs/notes/05-end-to-end-review.md`](./notes/05-end-to-end-review.md)。

## Boundary

The Codex app-server is server-only. Browser code must never import the SDK/protocol client or read local Codex authentication files.

## Runtime flow

```text
POST user turn
  -> chat server function
  -> CodexRuntime interface
  -> CodexAppServerRuntime
  -> thread/start or thread/resume
  -> turn/start
  -> item/agentMessage/delta notifications
  -> normalize app-server notifications to app ChatEvent
  -> async stream back to browser
  -> reducer updates message/activity state
```

## Application event contract

The UI depends on an application-owned event contract rather than Codex SDK event shapes. This keeps future Claude/Pi/Qwen adapters possible without rewriting the chat surface.

Initial event families:

- `thread.started`
- `assistant.started`
- `assistant.delta`
- `assistant.completed`
- `activity.started`
- `activity.updated`
- `activity.completed`
- `turn.completed`
- `error`

## Persistence

V0 browser persistence uses `localStorage` for `threadId` and transcript. Codex owns its own persisted thread state. No application database is introduced in this demo.

## Non-goals

- Multi-user SaaS
- Centralized authentication
- Database/message synchronization
- Multi-agent orchestration
- MCP management UI
- Writable workspace
- Production deployment hardening
