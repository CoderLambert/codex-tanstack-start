# Codex + TanStack Start Demo

Minimal proof of concept for using the local Codex app-server as a **personal-agent runtime** behind a TanStack Start web UI.

The browser never receives Codex credentials or raw protocol objects. TanStack Start runs the Codex app-server on the server side, normalizes its structured notifications into an application-owned `ChatEvent` contract, and streams those events back to the React UI.

## What this demo validates

- TanStack Start server functions can stream an async generator to the browser.
- Codex app-server can start and resume Codex threads.
- Codex app-server `item/agentMessage/delta` notifications reach the UI as real assistant deltas.
- The server-side SDK can reuse the Codex/ChatGPT authentication already available on the host.
- The browser persists only `{ threadId, messages }` in versioned localStorage.
- Agent activity is rendered without exposing raw reasoning, command output, MCP payloads, local paths, or authentication material.
- V0 runs Codex with a read-only sandbox policy.

## Architecture

```text
Browser / React 19
       |
       | typed async stream
       v
TanStack Start Server Function
       |
       v
ChatEvent normalizer
       |
       v
CodexRuntime interface (server only)
       |
       v
CodexAppServerRuntime
       |
       v
codex app-server + local ChatGPT/Codex authentication
```

Client state follows one path:

```text
streamChat()
   -> ChatEvent
   -> toChatStateEvent()
   -> chatReducer()
   -> ChatPage
```

## Requirements

- Node.js 18+
- npm
- A working Codex installation/authentication on the same machine that runs the TanStack Start server
- The selected workspace must be a Git repository unless the runtime policy is changed

## Authentication: ChatGPT/Codex subscription path

This demo intentionally does **not** require `OPENAI_API_KEY` for the subscription-auth path.

1. On the machine that will run this app, launch the Codex CLI.
2. Complete its **Sign in with ChatGPT** flow if you are not already authenticated.
3. Verify Codex itself can start a local session.
4. Start this app from the same user account/environment so the SDK-spawned Codex runtime can reuse that local authentication.

The SDK is kept behind the server boundary. Do not send auth tokens, `~/.codex` contents, or API keys from the browser.

## Run locally

```bash
cp .env.example .env
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

Optional workspace root:

```bash
CODEX_WORKSPACE_ROOT=/absolute/path/to/git/workspace npm run dev
```

If `CODEX_WORKSPACE_ROOT` is omitted, V0 uses the server process working directory. Workspace paths are canonicalized and constrained to that root.

## Safety baseline

Every Codex app-server thread/turn is created or resumed with:

```text
model: luna
effort: high
sandbox: read-only
sandboxPolicy.networkAccess: false
approvalPolicy: never
```

This demo therefore targets repository inspection, explanation, reasoning, and other read-only workflows. File mutation is deliberately not enabled.

## Commands

```bash
npm run typecheck
npm test
npm run build
npm run dev
```

## Persistence

The browser stores only the active conversation metadata required for the demo:

```text
threadId
messages[]
```

Transient activities, errors, credentials, SDK events, and command output are not persisted. **New Chat** clears the active browser conversation; it does not delete historical Codex session files from `~/.codex/sessions`.

## Known limitations

- V0 has one active browser conversation and one configured workspace root.
- Assistant text is emitted from app-server deltas while the turn is running, then calibrated with the completed item snapshot.
- The runtime is fixed to the `luna` model with `high` reasoning effort; there is no UI for changing the model, reasoning effort, workspace, or permissions.
- There is no write-mode approval flow; the runtime is intentionally read-only.
- New Chat ignores any remaining client-side events from the previous turn, but does not currently propagate an explicit cancellation signal through the TanStack Start RPC to terminate the underlying Codex process immediately.
- Raw reasoning text, command stdout/stderr, MCP arguments/results, and detailed server exceptions are intentionally hidden from the browser.
- Codex session persistence is owned by Codex (`~/.codex/sessions`); the browser stores only the opaque thread id needed to resume it.

## Project structure

```text
src/
├── features/chat/           # reducer, persistence, client adapter/controller, UI
├── server/codex/            # server-only Codex runtime and workspace policy
├── server-functions/        # TanStack Start stream + event normalization
└── routes/                  # page wiring
```

See `docs/DEVELOPMENT_PLAN.md` and `docs/tasks/` for the original five-task split.
