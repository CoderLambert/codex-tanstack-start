import { describe, expect, it } from 'vitest'
import type { CodexThreadEvent } from '../codex-event.types'
import { streamNormalizedChatEvents } from '../chat-stream'

describe('streamNormalizedChatEvents', () => {
  it('flattens normalized Codex events in source order', async () => {
    const events: CodexThreadEvent[] = [
      { type: 'thread.started', thread_id: 'thread-1' },
      { type: 'turn.started' },
      {
        type: 'item.completed',
        item: { id: 'm1', type: 'agent_message', text: 'Done' },
      },
      {
        type: 'turn.completed',
        usage: {
          input_tokens: 1,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 2,
          reasoning_output_tokens: 0,
        },
      },
    ]

    async function* source() {
      yield* events
    }

    const output = []
    for await (const event of streamNormalizedChatEvents(
      { message: 'hello' },
      async () => source(),
    )) {
      output.push(event)
    }

    expect(output.map((event) => event.type)).toEqual([
      'thread.started',
      'assistant.message',
      'turn.completed',
    ])
  })
})
