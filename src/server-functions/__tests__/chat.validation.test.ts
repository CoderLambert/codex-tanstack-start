import { describe, expect, it } from 'vitest'
import { validateChatRequest } from '../chat.validation'

describe('validateChatRequest', () => {
  it('trims a valid message and optional thread id', () => {
    expect(validateChatRequest({ message: '  hello  ', threadId: ' thread-123 ' })).toEqual({
      message: 'hello',
      threadId: 'thread-123',
    })
  })

  it('rejects empty messages', () => {
    expect(() => validateChatRequest({ message: '   ' })).toThrow('Message cannot be empty.')
  })

  it('rejects thread ids containing whitespace', () => {
    expect(() => validateChatRequest({ message: 'hello', threadId: 'bad id' })).toThrow(
      'Thread ID is invalid.',
    )
  })
})
