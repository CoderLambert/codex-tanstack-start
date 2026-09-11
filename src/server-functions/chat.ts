import { createServerFn } from '@tanstack/react-start'
import { streamCodexTurn } from './chat.runtime.server'
import { streamNormalizedChatEvents } from './chat-stream'
import { validateChatRequest } from './chat.validation'

/**
 * Type-safe streaming RPC for the browser.
 *
 * This module is intentionally client-importable: TanStack Start replaces the
 * createServerFn handler with its RPC bridge in the client build. The actual
 * Codex runtime remains isolated behind *.server.ts modules.
 */
export const streamChat = createServerFn({ method: 'POST' })
  .validator(validateChatRequest)
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
