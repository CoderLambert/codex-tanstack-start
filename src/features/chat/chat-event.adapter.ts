import type { ChatEvent } from './chat.types'
import type { ChatStateEvent } from './chat.reducer'

/** Convert the transport contract into deterministic reducer events. */
export function toChatStateEvent(
  event: ChatEvent,
  receivedAt: number,
): ChatStateEvent {
  switch (event.type) {
    case 'thread.started':
      return event

    case 'assistant.message':
      return {
        type: 'assistant.message',
        message: {
          id: event.id,
          role: 'assistant',
          content: event.text,
          createdAt: receivedAt,
        },
      }

    case 'activity.started':
    case 'activity.updated':
      return {
        type: event.type,
        activity: event.activity,
      }

    case 'activity.completed':
      return {
        type: 'activity.completed',
        activity: event.activity,
      }

    case 'turn.completed':
      return { type: 'turn.completed' }

    case 'error':
      return event
  }
}
