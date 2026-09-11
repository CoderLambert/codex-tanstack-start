# Task 01 — Codex runtime

Implement the server-only Codex runtime wrapper.

## Requirements
- Keep the Codex app-server process and protocol client in server-only code.
- Support `thread/start` and `thread/resume(threadId)`.
- Expose a streaming turn method based on `turn/start` notifications.
- Forward `item/agentMessage/delta` events without exposing raw app-server messages.
- Use the `luna` model with `high` reasoning effort for every thread.
- Use a read-only sandbox/workspace posture for V0.
- Validate/resolve workspace path server-side.
- Return useful typed errors when Codex authentication or runtime startup fails.

## Primary ownership
`src/server/codex/**`

## Tests
Unit-test input validation and thread selection logic without requiring a live Codex request where practical.
