export type ChatRunStatus = 'idle' | 'running' | 'error'

export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: number
}

export type AgentActivityStatus = 'running' | 'completed' | 'failed'

export interface AgentActivity {
  id: string
  kind: string
  status: AgentActivityStatus
  summary: string
  detail?: string
}

export interface PersistedConversation {
  threadId: string | null
  messages: ChatMessage[]
}

export interface ChatState extends PersistedConversation {
  activities: AgentActivity[]
  status: ChatRunStatus
  error: string | null
}

/**
 * State-layer event contract.
 *
 * Task 02 owns the transport-level ChatEvent contract. Task 05 should adapt that
 * contract to these deterministic state events instead of importing Codex SDK
 * shapes into client state.
 */
export type ChatStateEvent =
  | { type: 'thread.started'; threadId: string }
  | { type: 'assistant.started'; id: string; createdAt: number }
  | { type: 'assistant.delta'; id: string; delta: string }
  | { type: 'assistant.completed'; id: string; text: string }
  | { type: 'activity.started'; activity: AgentActivity }
  | {
      type: 'activity.updated'
      activity: Partial<Omit<AgentActivity, 'id'>> & Pick<AgentActivity, 'id'>
    }
  | { type: 'activity.completed'; activity: AgentActivity }
  | { type: 'turn.completed' }
  | { type: 'error'; message: string }

export type ChatAction =
  | { type: 'user.message.added'; message: ChatMessage }
  | { type: 'turn.started' }
  | { type: 'event.received'; event: ChatStateEvent }
  | { type: 'conversation.restored'; conversation: PersistedConversation }
  | { type: 'new-chat' }

export const initialChatState: ChatState = {
  threadId: null,
  messages: [],
  activities: [],
  status: 'idle',
  error: null,
}

function upsertMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const index = messages.findIndex((item) => item.id === message.id)

  if (index === -1) {
    return [...messages, message]
  }

  const next = [...messages]
  next[index] = message
  return next
}

function upsertActivity(
  activities: AgentActivity[],
  activity: AgentActivity,
): AgentActivity[] {
  const index = activities.findIndex((item) => item.id === activity.id)

  if (index === -1) {
    return [...activities, activity]
  }

  const next = [...activities]
  next[index] = activity
  return next
}

export function applyChatEvent(state: ChatState, event: ChatStateEvent): ChatState {
  switch (event.type) {
    case 'thread.started':
      return {
        ...state,
        threadId: event.threadId,
      }

    case 'assistant.started':
      if (state.messages.some((message) => message.id === event.id)) {
        return state
      }

      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: event.id,
            role: 'assistant',
            content: '',
            createdAt: event.createdAt,
          },
        ],
      }

    case 'assistant.delta': {
      const index = state.messages.findIndex((message) => message.id === event.id)
      if (index === -1) {
        return {
          ...state,
          messages: [
            ...state.messages,
            {
              id: event.id,
              role: 'assistant',
              content: event.delta,
              createdAt: Date.now(),
            },
          ],
        }
      }

      const message = state.messages[index]
      if (!message || message.role !== 'assistant') return state

      const messages = [...state.messages]
      messages[index] = { ...message, content: message.content + event.delta }
      return { ...state, messages }
    }

    case 'assistant.completed': {
      const existing = state.messages.find((message) => message.id === event.id)
      return {
        ...state,
        messages: upsertMessage(state.messages, {
          id: event.id,
          role: 'assistant',
          content: event.text,
          createdAt: existing?.createdAt ?? Date.now(),
        }),
      }
    }

    case 'activity.started':
      return {
        ...state,
        activities: upsertActivity(state.activities, event.activity),
      }

    case 'activity.updated':
      return {
        ...state,
        activities: state.activities.map((activity) =>
          activity.id === event.activity.id
            ? { ...activity, ...event.activity }
            : activity,
        ),
      }

    case 'activity.completed':
      return {
        ...state,
        activities: upsertActivity(state.activities, event.activity),
      }

    case 'turn.completed':
      return {
        ...state,
        status: 'idle',
        error: null,
      }

    case 'error':
      return {
        ...state,
        status: 'error',
        error: event.message,
      }
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'user.message.added':
      return {
        ...state,
        messages: upsertMessage(state.messages, action.message),
        error: null,
      }

    case 'turn.started':
      return {
        ...state,
        activities: [],
        status: 'running',
        error: null,
      }

    case 'event.received':
      return applyChatEvent(state, action.event)

    case 'conversation.restored':
      return {
        ...initialChatState,
        threadId: action.conversation.threadId,
        messages: action.conversation.messages,
      }

    case 'new-chat':
      return initialChatState
  }
}
