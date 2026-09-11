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

    case 'assistant.started':
      return {
        type: 'assistant.started',
        id: event.id,
        createdAt: receivedAt,
      }

    case 'assistant.delta':
      return event

    case 'assistant.completed':
      return event

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
