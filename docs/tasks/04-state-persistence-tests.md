# Task 04 — State, persistence, tests

Implement deterministic client state and local persistence.

## Requirements
- `useReducer`-style state machine for messages, activities, running/error state.
- Persist `{ threadId, messages }` to localStorage with a versioned key.
- Restore safely when persisted JSON is invalid.
- New Chat clears active local conversation state.
- Unit tests for reducer/event application/storage helpers.

## Primary ownership
`src/features/chat/chat.reducer.ts`, `src/features/chat/chat.storage.ts`, tests next to those modules.

## Implemented integration contract

Task 04 exports deterministic client-state primitives from `src/features/chat/chat.reducer.ts`:

- `ChatState`, `ChatMessage`, `AgentActivity`
- `ChatAction` + `chatReducer(state, action)`
- `ChatStateEvent` + `applyChatEvent(state, event)`
- `initialChatState`

Task 05 should adapt Task 02's transport `ChatEvent` into `ChatStateEvent`, then dispatch it as `{ type: 'event.received', event }`. The state layer intentionally has no dependency on `@openai/codex-sdk`.

Persistence helpers live in `src/features/chat/chat.storage.ts`:

- `loadConversation(storage)` safely restores `{ threadId, messages }` and returns `null` on malformed/stale/unavailable storage.
- `saveConversation(storage, conversation)` and `clearConversation(storage)` return a boolean instead of throwing on browser storage failures.
- `conversationFromState(state)` strips transient activity/running/error fields before persistence.
- `getBrowserStorage()` is SSR-safe.
