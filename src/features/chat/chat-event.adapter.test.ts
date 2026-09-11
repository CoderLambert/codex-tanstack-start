import { describe, expect, it } from 'vitest'
import { toChatStateEvent } from './chat-event.adapter'

it('converts assistant lifecycle events into reducer events', () => {
  expect(
    toChatStateEvent(
      { type: 'assistant.started', id: 'm1' },
      123,
    ),
  ).toEqual({
    type: 'assistant.started',
    id: 'm1',
    createdAt: 123,
  })

  expect(toChatStateEvent({ type: 'assistant.delta', id: 'm1', delta: 'Hello' }, 123)).toEqual({
    type: 'assistant.delta',
    id: 'm1',
    delta: 'Hello',
  })

  expect(toChatStateEvent({ type: 'assistant.completed', id: 'm1', text: 'Hello' }, 123)).toEqual({
    type: 'assistant.completed',
    id: 'm1',
    text: 'Hello',
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
