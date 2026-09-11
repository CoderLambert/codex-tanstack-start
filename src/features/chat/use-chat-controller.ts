import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { streamChat } from '../../server-functions/chat.server'
import { toChatStateEvent } from './chat-event.adapter'
import {
  chatReducer,
  initialChatState,
  type ChatMessage,
  type ChatState,
} from './chat.reducer'
import {
  clearConversation,
  conversationFromState,
  getBrowserStorage,
  loadConversation,
  saveConversation,
} from './chat.storage'

export interface ChatController {
  state: ChatState
  sendMessage: (content: string) => Promise<void>
  newChat: () => void
}

export function useChatController(): ChatController {
  const [state, dispatch] = useReducer(chatReducer, initialChatState)
  const [restored, setRestored] = useState(false)
  const stateRef = useRef(state)
  const generationRef = useRef(0)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    const storage = getBrowserStorage()
    const conversation = storage ? loadConversation(storage) : null
    if (conversation) {
      dispatch({ type: 'conversation.restored', conversation })
    }
    setRestored(true)
  }, [])

  useEffect(() => {
    if (!restored) return
    const storage = getBrowserStorage()
    if (storage) saveConversation(storage, conversationFromState(state))
  }, [restored, state.threadId, state.messages])

  const sendMessage = useCallback(async (content: string) => {
    if (stateRef.current.status === 'running') return

    const generation = generationRef.current
    const userMessage: ChatMessage = {
      id: createId('user'),
      role: 'user',
      content,
      createdAt: Date.now(),
    }

    dispatch({ type: 'user.message.added', message: userMessage })
    dispatch({ type: 'turn.started' })

    try {
      const events = await streamChat({
        data: {
          message: content,
          threadId: stateRef.current.threadId ?? undefined,
        },
      })

      for await (const event of events) {
        if (generation !== generationRef.current) return
        dispatch({
          type: 'event.received',
          event: toChatStateEvent(event, Date.now()),
        })
      }
    } catch (error) {
      if (generation !== generationRef.current) return
      dispatch({
        type: 'event.received',
        event: {
          type: 'error',
          message: error instanceof Error ? error.message : 'Codex request failed.',
        },
      })
    }
  }, [])

  const newChat = useCallback(() => {
    generationRef.current += 1
    dispatch({ type: 'new-chat' })
    const storage = getBrowserStorage()
    if (storage) clearConversation(storage)
  }, [])

  return { state, sendMessage, newChat }
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
