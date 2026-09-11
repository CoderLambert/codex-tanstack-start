# Task 05 integration notes

> **文档定位：集成实施记录。** 本文记录 Task 05 当时如何收敛模块边界，不作为长期学习入口。关于 Runtime/App Server 的系统知识请阅读 [`docs/notes/02-codex-app-server-streaming.md`](./notes/02-codex-app-server-streaming.md)；关于 TanStack/React 状态模型请阅读 [`docs/notes/03-tanstack-streaming-state.md`](./notes/03-tanstack-streaming-state.md)；完整链路请阅读 [`docs/notes/05-end-to-end-review.md`](./notes/05-end-to-end-review.md)。

## Resolved module boundaries

### Task 01 -> Task 02

`src/server-functions/chat.runtime.server.ts` is the only integration seam between the server-function layer and the Codex runtime:

```ts
getCodexRuntime().streamTurn({
  prompt: request.message,
  threadId: request.threadId,
})
```

Codex app-server notifications are converted at the seam to Task 02's structural server-only event type. Browser-reachable modules do not import `@openai/codex-sdk` or app-server protocol objects.

### Task 02 -> Task 04

Task 02 owns the transport contract in `src/features/chat/chat.types.ts`.
Task 04 owns deterministic client state in `chat.reducer.ts`.

The single adapter is:

```text
src/features/chat/chat-event.adapter.ts
```

It adds the client receive timestamp required by persisted assistant messages and maps activity completion semantics without leaking Codex SDK shapes into state.

### Task 04 -> Task 03

`useChatController()` owns streaming, reducer dispatch, stale-stream invalidation, restore, and persistence. `ChatPage` is controlled and renders only reducer state.

This removes Task 03's preview-only internal state so there is one source of truth.

## Security boundary

The browser may receive:

- opaque `threadId`
- assistant message text
- sanitized activity summaries/status
- aggregate token usage event (not currently rendered)
- generic/sanitized errors

It does not receive raw reasoning text, command output, MCP arguments/results, local auth data, or arbitrary runtime errors.
