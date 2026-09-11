import { createServerFn } from '@tanstack/react-start'
import { streamCodexTurn } from './chat.runtime.server'
import { streamNormalizedChatEvents } from './chat-stream'
import { validateChatRequest } from './chat.validation'

/**
 * Type-safe streaming RPC for the browser.
 *
 * TanStack Start executes the handler only on the server and serializes yielded
 * `ChatEvent` values to the caller as an async stream.
 */
export const streamChat = createServerFn({ method: 'POST' })
  .inputValidator(validateChatRequest)
  .handler(async function* ({ data }) {
    try {
      yield* streamNormalizedChatEvents(data, streamCodexTurn)
    } catch (error) {
      // Do not serialize arbitrary runtime errors. They may include local paths,
      // process details, or credentials. Keep detailed diagnostics server-side.
      console.error('Codex chat stream failed', error)
      yield {
        type: 'error' as const,
        message: 'Codex turn failed. Check the server logs for details.',
      }
    }
  })
