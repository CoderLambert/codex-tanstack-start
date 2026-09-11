# Task 02 integration notes

## Delivered contract

Task 02 owns the browser-safe event boundary:

- `src/features/chat/chat.types.ts` — `ChatRequest`, `ChatEvent`, activity, and usage types.
- `src/server-functions/codex-event.types.ts` — minimal structural mirror of Codex SDK events used only at the server boundary.
- `src/server-functions/codex-event-normalizer.ts` — Codex event -> `ChatEvent[]` normalization.
- `src/server-functions/chat-stream.ts` — async iterable bridge independent of TanStack/Codex runtime details.
- `src/server-functions/chat.ts` — TanStack Start POST server function returning an async generator.
- `src/server-functions/chat.runtime.server.ts` — explicit Task 01/05 integration seam.

## Task 05 integration assumption

Task 01 should expose enough behavior to implement this structural port:

```ts
async function* streamCodexTurn(
  request: ChatRequest,
): AsyncGenerator<CodexThreadEvent>
```

Expected behavior:

1. If `request.threadId` is absent, call `codex.startThread(...)`.
2. Otherwise call `codex.resumeThread(request.threadId, ...)`.
3. Call `thread.runStreamed(request.message)`.
4. `yield* result.events`.
5. Configure the V0 runtime as read-only in Task 01/05.

No SDK event object should bypass `normalizeCodexEvent` on its way to the browser.

## Deliberate redactions

The normalized browser contract does not expose:

- reasoning text,
- command stdout/stderr,
- MCP arguments or results,
- raw SDK error objects,
- authentication/session file contents.

The opaque Codex `threadId` is exposed because it is required to resume a conversation. It should be treated as an identifier, not an authentication credential.

## Streaming semantics

`agent_message` is emitted only from `item.completed`. Current Codex TypeScript SDK `item.updated` events are item snapshots, not documented text deltas, so concatenating them would risk duplicate message content. Activity events may start/update/complete throughout the turn.
