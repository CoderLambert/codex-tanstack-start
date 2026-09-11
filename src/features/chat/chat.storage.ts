import type { ChatMessage, ChatState, PersistedConversation } from './chat.reducer'

export const CHAT_STORAGE_VERSION = 1 as const
export const CHAT_STORAGE_KEY = `codex-tanstack-demo:conversation:v${CHAT_STORAGE_VERSION}`

interface StoredConversationEnvelope {
  version: typeof CHAT_STORAGE_VERSION
  conversation: PersistedConversation
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!isRecord(value)) return false

  return (
    typeof value.id === 'string' &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string' &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt)
  )
}

export function parseStoredConversation(raw: string): PersistedConversation | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return null
    if (parsed.version !== CHAT_STORAGE_VERSION) return null
    if (!isRecord(parsed.conversation)) return null

    const { threadId, messages } = parsed.conversation
    if (!(threadId === null || typeof threadId === 'string')) return null
    if (!Array.isArray(messages) || !messages.every(isChatMessage)) return null

    return {
      threadId,
      messages: messages.map((message) => ({ ...message })),
    }
  } catch {
    return null
  }
}

export function serializeConversation(
  conversation: PersistedConversation,
): string {
  const envelope: StoredConversationEnvelope = {
    version: CHAT_STORAGE_VERSION,
    conversation: {
      threadId: conversation.threadId,
      messages: conversation.messages,
    },
  }

  return JSON.stringify(envelope)
}

export function conversationFromState(state: ChatState): PersistedConversation {
  return {
    threadId: state.threadId,
    messages: state.messages,
  }
}

export function loadConversation(storage: StorageLike): PersistedConversation | null {
  try {
    const raw = storage.getItem(CHAT_STORAGE_KEY)
    if (raw === null) return null

    const conversation = parseStoredConversation(raw)

    // Invalid or stale persisted data should not poison every future page load.
    if (conversation === null) {
      try {
        storage.removeItem(CHAT_STORAGE_KEY)
      } catch {
        // Best-effort cleanup only; restore must remain safe.
      }
    }

    return conversation
  } catch {
    return null
  }
}

export function saveConversation(
  storage: StorageLike,
  conversation: PersistedConversation,
): boolean {
  try {
    storage.setItem(CHAT_STORAGE_KEY, serializeConversation(conversation))
    return true
  } catch {
    return false
  }
}

export function clearConversation(storage: StorageLike): boolean {
  try {
    storage.removeItem(CHAT_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

/** Browser-safe storage lookup. Useful for SSR-aware TanStack Start components. */
export function getBrowserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage
  } catch {
    return null
  }
}
