import { describe, expect, it } from 'vitest'
import { isCurrentChatGeneration } from './use-chat-controller'

describe('isCurrentChatGeneration', () => {
  it('rejects events from a stream superseded by New Chat', () => {
    expect(isCurrentChatGeneration(3, 4)).toBe(false)
    expect(isCurrentChatGeneration(4, 4)).toBe(true)
  })
})
