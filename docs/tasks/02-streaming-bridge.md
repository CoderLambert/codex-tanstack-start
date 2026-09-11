# Task 02 — Streaming bridge

Create the application event contract and TanStack Start streaming server function.

## Requirements
- Define app-owned `ChatEvent` types.
- Normalize Codex thread/item events into `ChatEvent`.
- Use a TanStack Start server function returning an async stream/async generator.
- Accept `{ message, threadId? }` and validate empty input.
- Never leak opaque auth/session material to the browser.

## Primary ownership
`src/server-functions/**`, `src/features/chat/chat.types.ts`, adapter normalization files agreed with Task 01.
