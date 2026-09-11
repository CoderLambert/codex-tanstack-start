import { describe, expect, it } from 'vitest'
import type { ChatState, PersistedConversation } from './chat.reducer'
import {
  CHAT_STORAGE_KEY,
  CHAT_STORAGE_VERSION,
  clearConversation,
  conversationFromState,
  loadConversation,
  parseStoredConversation,
  saveConversation,
  serializeConversation,
  type StorageLike,
} from './chat.storage'

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

const conversation: PersistedConversation = {
  threadId: 'thread-1',
  messages: [
    {
      id: 'm1',
      role: 'user',
      content: 'hello',
      createdAt: 123,
    },
  ],
}

describe('conversation serialization', () => {
  it('round-trips versioned persisted state', () => {
    const serialized = serializeConversation(conversation)

    expect(parseStoredConversation(serialized)).toEqual(conversation)
    expect(JSON.parse(serialized)).toMatchObject({
      version: CHAT_STORAGE_VERSION,
      conversation: { threadId: 'thread-1' },
    })
  })

  it('rejects malformed JSON, stale versions, and malformed messages', () => {
    expect(parseStoredConversation('{bad')).toBeNull()
    expect(
      parseStoredConversation(
        JSON.stringify({ version: 999, conversation }),
      ),
    ).toBeNull()
    expect(
      parseStoredConversation(
        JSON.stringify({
          version: CHAT_STORAGE_VERSION,
          conversation: {
            threadId: 'thread-1',
            messages: [{ id: 'm1', role: 'bogus', content: 'x', createdAt: 1 }],
          },
        }),
      ),
    ).toBeNull()
  })
})

describe('storage helpers', () => {
  it('saves, loads, and clears the active conversation', () => {
    const storage = new MemoryStorage()

    saveConversation(storage, conversation)
    expect(loadConversation(storage)).toEqual(conversation)

    clearConversation(storage)
    expect(loadConversation(storage)).toBeNull()
  })

  it('removes invalid persisted data during safe restore', () => {
    const storage = new MemoryStorage()
    storage.setItem(CHAT_STORAGE_KEY, 'not-json')

    expect(loadConversation(storage)).toBeNull()
    expect(storage.getItem(CHAT_STORAGE_KEY)).toBeNull()
  })

  it('does not throw when browser storage itself is unavailable', () => {
    const unavailable: StorageLike = {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('blocked') },
      removeItem() { throw new Error('blocked') },
    }

    expect(loadConversation(unavailable)).toBeNull()
    expect(saveConversation(unavailable, conversation)).toBe(false)
    expect(clearConversation(unavailable)).toBe(false)
  })

  it('persists only threadId and messages from runtime state', () => {
    const state: ChatState = {
      ...conversation,
      activities: [
        {
          id: 'a1',
          kind: 'reasoning',
          status: 'running',
          summary: 'thinking',
        },
      ],
      status: 'running',
      error: 'transient',
    }

    expect(conversationFromState(state)).toEqual(conversation)
  })
})
