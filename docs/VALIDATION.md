# Validation report

> **文档定位：某次集成验证快照。** 这里记录当时实际跑过的检查与修复，不应被视为当前所有可靠性结论。关于“测试通过仍不能证明什么”、fake app-server、correlation、interrupt、process cleanup 与安全边界，请阅读 [`docs/notes/04-testing-reliability-security.md`](./notes/04-testing-reliability-security.md)。

Task 05 integration was performed against the common base and the Task 01-04 outputs were reconciled into one transport/state/UI pipeline.

## Final checks

Validation was rerun in GitHub Actions on Node.js 22 with a network-enabled npm environment.

- dependency installation: PASS (`npm install --no-audit --no-fund`)
- `npm run typecheck`: PASS
- `npm test`: PASS — 10 test files, 37 tests
- `npm run build`: PASS
- V0 runtime policy remains read-only (`sandboxMode: read-only`, `approvalPolicy: never`, network disabled)
- app-server smoke verification: PASS (`item/started` -> multiple `item/agentMessage/delta` -> `item/completed` -> `turn/completed`)
- documented authentication path reuses the host Codex/ChatGPT login; `OPENAI_API_KEY` is not required for that subscription-auth path

## Integration defects fixed during final validation

1. Removed deprecated TypeScript `baseUrl`; the `~/*` path mapping remains relative to `tsconfig.json`.
2. Moved the client-importable TanStack `createServerFn` definition from `chat.server.ts` to `chat.ts`. This allows TanStack Start to generate the client RPC bridge while keeping the actual Codex runtime in `*.server.ts` modules.
3. Migrated `createServerFn().inputValidator()` to `createServerFn().validator()`.
4. Fixed CI so repositories without a committed npm lockfile do not fail during `setup-node` cache initialization.

The successful CI run validates installation, type checking, the full unit/integration test suite, and the production bundle.
