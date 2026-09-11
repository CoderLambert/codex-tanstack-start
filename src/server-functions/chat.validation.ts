import type { ChatRequest } from '../features/chat/chat.types'

const MAX_MESSAGE_LENGTH = 32_000
const MAX_THREAD_ID_LENGTH = 512

export function validateChatRequest(input: unknown): ChatRequest {
  if (!isRecord(input)) {
    throw new Error('Chat request must be an object.')
  }

  if (typeof input.message !== 'string') {
    throw new Error('Message must be a string.')
  }

  const message = input.message.trim()
  if (message.length === 0) {
    throw new Error('Message cannot be empty.')
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message must be at most ${MAX_MESSAGE_LENGTH} characters.`)
  }

  if (input.threadId === undefined || input.threadId === null || input.threadId === '') {
    return { message }
  }

  if (typeof input.threadId !== 'string') {
    throw new Error('Thread ID must be a string.')
  }

  const threadId = input.threadId.trim()
  if (threadId.length === 0 || threadId.length > MAX_THREAD_ID_LENGTH || /\s/.test(threadId)) {
    throw new Error('Thread ID is invalid.')
  }

  return { message, threadId }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
