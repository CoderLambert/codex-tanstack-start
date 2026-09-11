# Task 01 — Codex runtime

Implement the server-only Codex runtime wrapper.

## Requirements
- Instantiate `Codex` only in server-only code.
- Support `startThread()` and `resumeThread(threadId)`.
- Expose a streaming turn method based on `runStreamed()`.
- Use a read-only sandbox/workspace posture for V0.
- Validate/resolve workspace path server-side.
- Return useful typed errors when Codex authentication or runtime startup fails.

## Primary ownership
`src/server/codex/**`

## Tests
Unit-test input validation and thread selection logic without requiring a live Codex request where practical.
