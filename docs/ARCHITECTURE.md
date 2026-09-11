# Architecture

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
