import type { ChatRequest } from '../features/chat/chat.types'
import { getCodexRuntime } from '../server/codex/index.server'
import type { CodexThreadEvent } from './codex-event.types'

/**
 * Server-only integration seam between the browser-safe streaming bridge and
 * the Codex runtime. Authentication stays entirely inside the local Codex SDK
 * process; no API key or auth material crosses this boundary.
 */
export async function* streamCodexTurn(
  request: ChatRequest,
): AsyncGenerator<CodexThreadEvent> {
  const runtime = getCodexRuntime()

  for await (const event of runtime.streamTurn({
    prompt: request.message,
    threadId: request.threadId,
  })) {
    // Task 02 intentionally owns a small structural mirror of the server event
    // contract so browser-reachable modules never import Codex runtime details.
    yield event as unknown as CodexThreadEvent
  }
}
