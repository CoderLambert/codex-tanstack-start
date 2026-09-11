import { describe, expect, it } from 'vitest'
import {
  applyChatEvent,
  chatReducer,
  initialChatState,
  type AgentActivity,
  type ChatMessage,
} from './chat.reducer'

const userMessage: ChatMessage = {
  id: 'u1',
  role: 'user',
  content: 'Hello',
  createdAt: 1,
}

const assistantMessage: ChatMessage = {
  id: 'a1',
  role: 'assistant',
  content: 'Hi',
  createdAt: 2,
}

const runningActivity: AgentActivity = {
  id: 'activity-1',
  kind: 'command',
  status: 'running',
  summary: 'Inspect repository',
}

describe('chatReducer', () => {
  it('starts a turn, appends a user message, and clears a previous error', () => {
    const errored = {
      ...initialChatState,
      status: 'error' as const,
      error: 'old failure',
    }

    const withMessage = chatReducer(errored, {
      type: 'user.message.added',
      message: userMessage,
    })
    const running = chatReducer(withMessage, { type: 'turn.started' })

    expect(running.messages).toEqual([userMessage])
    expect(running.status).toBe('running')
    expect(running.error).toBeNull()
  })

  it('restores only persisted conversation fields', () => {
    const restored = chatReducer(
      {
        ...initialChatState,
        status: 'running',
        activities: [runningActivity],
      },
      {
        type: 'conversation.restored',
        conversation: {
          threadId: 'thread-1',
          messages: [userMessage],
        },
      },
    )

    expect(restored).toEqual({
      ...initialChatState,
      threadId: 'thread-1',
      messages: [userMessage],
    })
  })

  it('new chat resets the complete active client conversation state', () => {
    const active = {
      threadId: 'thread-1',
      messages: [userMessage, assistantMessage],
      activities: [runningActivity],
      status: 'error' as const,
      error: 'failed',
    }

    expect(chatReducer(active, { type: 'new-chat' })).toEqual(initialChatState)
  })
})

describe('applyChatEvent', () => {
  it('captures the Codex thread id without changing transcript state', () => {
    const state = { ...initialChatState, messages: [userMessage] }

    const next = applyChatEvent(state, {
      type: 'thread.started',
      threadId: 'thread-42',
    })

    expect(next.threadId).toBe('thread-42')
    expect(next.messages).toEqual([userMessage])
  })

  it('creates one assistant message, appends deltas, and calibrates on completion', () => {
    const running = chatReducer(initialChatState, { type: 'turn.started' })
    const started = applyChatEvent(running, {
      type: 'assistant.started',
      id: assistantMessage.id,
      createdAt: assistantMessage.createdAt,
    })
    const duplicateStarted = applyChatEvent(started, {
      type: 'assistant.started',
      id: assistantMessage.id,
      createdAt: 99,
    })
    const firstDelta = applyChatEvent(duplicateStarted, {
      type: 'assistant.delta',
      id: assistantMessage.id,
      delta: 'Hi',
    })
    const secondDelta = applyChatEvent(firstDelta, {
      type: 'assistant.delta',
      id: assistantMessage.id,
      delta: ' there',
    })
    const completed = applyChatEvent(secondDelta, {
      type: 'assistant.completed',
      id: assistantMessage.id,
      text: 'Hi again',
    })

    expect(duplicateStarted.messages).toHaveLength(1)
    expect(secondDelta.messages[0]?.content).toBe('Hi there')
    expect(completed.messages[0]).toEqual({ ...assistantMessage, content: 'Hi again' })
    expect(completed.status).toBe('running')
  })

  it('does not mix deltas from different assistant ids', () => {
    const first = applyChatEvent(initialChatState, {
      type: 'assistant.started',
      id: 'a1',
      createdAt: 1,
    })
    const second = applyChatEvent(first, {
      type: 'assistant.started',
      id: 'a2',
      createdAt: 2,
    })
    const updated = applyChatEvent(second, {
      type: 'assistant.delta',
      id: 'a2',
      delta: 'second',
    })

    expect(updated.messages.map((message) => message.content)).toEqual(['', 'second'])
  })

  it('tracks activity lifecycle deterministically', () => {
    const started = applyChatEvent(initialChatState, {
      type: 'activity.started',
      activity: runningActivity,
    })
    const updated = applyChatEvent(started, {
      type: 'activity.updated',
      activity: { id: runningActivity.id, summary: 'Running tests' },
    })
    const completed = applyChatEvent(updated, {
      type: 'activity.completed',
      activity: {
        ...runningActivity,
        status: 'completed',
        summary: 'Running tests',
        detail: 'exit 0',
      },
    })

    expect(completed.activities).toEqual([
      {
        ...runningActivity,
        status: 'completed',
        summary: 'Running tests',
        detail: 'exit 0',
      },
    ])
  })

  it('marks success and failure terminal states', () => {
    const running = chatReducer(initialChatState, { type: 'turn.started' })
    const completed = applyChatEvent(running, { type: 'turn.completed' })
    const failed = applyChatEvent(running, {
      type: 'error',
      message: 'Codex failed',
    })

    expect(completed.status).toBe('idle')
    expect(completed.error).toBeNull()
    expect(failed.status).toBe('error')
    expect(failed.error).toBe('Codex failed')
  })
})
