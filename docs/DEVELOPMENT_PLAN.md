# Five-task development plan

The repository is intentionally split into four parallel implementation tracks plus one integration track. Parallel tasks should minimize overlapping file ownership.

| Task | Scope | Primary file ownership | Deliverable |
|---|---|---|---|
| 01 | Codex runtime | `src/server/codex/**` | thread start/resume + read-only runtime wrapper |
| 02 | Streaming bridge | `src/server-functions/**`, event types | async server stream + normalized `ChatEvent` contract |
| 03 | Chat UI | `src/features/chat/components/**`, route/styles | functional chat page and agent activity rendering |
| 04 | State/persistence/tests | reducer, storage, unit tests | reload/new-chat/error behavior + tests |
| 05 | Integration | whole repository after 01-04 | merge, resolve, install, typecheck/test/build, final archive |

## Merge contract

Tasks 01-04 should produce changes against this base repository independently. Task 05 is the only task allowed to perform broad conflict resolution or refactors spanning multiple modules.

## Definition of done

- No OpenAI API key required for the subscription-auth path.
- First message starts a Codex thread.
- Follow-up message resumes that thread.
- Browser receives meaningful structured progress while a turn runs.
- Transcript and `threadId` survive refresh.
- New Chat resets browser state without deleting Codex's persisted history.
- Failure states are visible and recoverable.
- `npm run typecheck`, `npm test`, and `npm run build` pass in integration.
