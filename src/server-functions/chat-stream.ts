import type { ChatEvent, ChatRequest } from '../features/chat/chat.types'
import type { CodexThreadEvent } from './codex-event.types'
import { normalizeCodexEvent } from './codex-event-normalizer'

export type CodexTurnStreamFactory = (
  request: ChatRequest,
) => AsyncIterable<CodexThreadEvent> | Promise<AsyncIterable<CodexThreadEvent>>

/** Pure bridge used by the TanStack Start server function and unit tests. */
export async function* streamNormalizedChatEvents(
  request: ChatRequest,
  createCodexTurnStream: CodexTurnStreamFactory,
): AsyncGenerator<ChatEvent> {
  const source = await createCodexTurnStream(request)

  for await (const codexEvent of source) {
    for (const chatEvent of normalizeCodexEvent(codexEvent)) {
      yield chatEvent
    }
  }
}
