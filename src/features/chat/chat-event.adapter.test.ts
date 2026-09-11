import { describe, expect, it } from 'vitest'
import { toChatStateEvent } from './chat-event.adapter'

it('converts an assistant transport event into a persisted reducer message', () => {
  expect(
    toChatStateEvent(
      { type: 'assistant.message', id: 'm1', text: 'Hello' },
      123,
    ),
  ).toEqual({
    type: 'assistant.message',
    message: {
      id: 'm1',
      role: 'assistant',
      content: 'Hello',
      createdAt: 123,
    },
  })
})

describe('activity event mapping', () => {
  it('maps completed activities to the reducer completion event', () => {
    expect(
      toChatStateEvent(
        {
          type: 'activity.completed',
          activity: {
            id: 'a1',
            kind: 'command',
            status: 'completed',
            summary: 'Command: npm',
          },
        },
        123,
      ),
    ).toEqual({
      type: 'activity.completed',
      activity: {
        id: 'a1',
        kind: 'command',
        status: 'completed',
        summary: 'Command: npm',
      },
    })
  })
})
