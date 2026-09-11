import { describe, expect, it } from 'vitest'
import {
  createCodexEventNormalizer,
  normalizeCodexEvent,
  sanitizeErrorMessage,
} from '../codex-event-normalizer'

describe('normalizeCodexEvent', () => {
  it('maps thread ids and usage without exposing SDK field names', () => {
    expect(normalizeCodexEvent({ type: 'thread.started', thread_id: 'thread-1' })).toEqual([
      { type: 'thread.started', threadId: 'thread-1' },
    ])

    expect(
      normalizeCodexEvent({
        type: 'turn.completed',
        usage: {
          input_tokens: 10,
          cached_input_tokens: 3,
          output_tokens: 5,
          reasoning_output_tokens: 2,
        },
      }),
    ).toEqual([
      {
        type: 'turn.completed',
        usage: {
          inputTokens: 10,
          cachedInputTokens: 3,
          cacheWriteInputTokens: 0,
          outputTokens: 5,
          reasoningOutputTokens: 2,
        },
      },
    ])
  })

  it('converts app-server deltas into assistant deltas', () => {
    expect(normalizeCodexEvent({
      type: 'item.agent_message.delta',
      item_id: 'm1',
      delta: 'Hello',
    })).toEqual([{ type: 'assistant.delta', id: 'm1', delta: 'Hello' }])
  })

  it('converts cumulative snapshots into safe deltas and final correction', () => {
    const normalizer = createCodexEventNormalizer()
    const started = { id: 'm1', type: 'agent_message' as const, text: '' }

    expect(normalizer.normalize({ type: 'item.started', item: started })).toEqual([
      { type: 'assistant.started', id: 'm1' },
    ])
    expect(normalizer.normalize({
      type: 'item.updated',
      item: { ...started, text: 'React' },
    })).toEqual([{ type: 'assistant.delta', id: 'm1', delta: 'React' }])
    expect(normalizer.normalize({
      type: 'item.updated',
      item: { ...started, text: 'React 是' },
    })).toEqual([{ type: 'assistant.delta', id: 'm1', delta: ' 是' }])
    expect(normalizer.normalize({
      type: 'item.updated',
      item: { ...started, text: 'A corrected answer' },
    })).toEqual([{ type: 'assistant.completed', id: 'm1', text: 'A corrected answer' }])
    expect(normalizer.normalize({
      type: 'item.completed',
      item: { ...started, text: 'A corrected answer' },
    })).toEqual([{ type: 'assistant.completed', id: 'm1', text: 'A corrected answer' }])
  })

  it('does not expose reasoning text, command output, or MCP payloads', () => {
    const reasoning = normalizeCodexEvent({
      type: 'item.started',
      item: { id: 'r1', type: 'reasoning', text: 'private reasoning details' },
    })
    expect(JSON.stringify(reasoning)).not.toContain('private reasoning details')

    const command = normalizeCodexEvent({
      type: 'item.updated',
      item: {
        id: 'c1',
        type: 'command_execution',
        command: 'npm test -- --run',
        aggregated_output: 'SECRET_OUTPUT',
        status: 'in_progress',
      },
    })
    expect(command).toEqual([
      {
        type: 'activity.updated',
        activity: { id: 'c1', kind: 'command', status: 'running', summary: 'Command: npm' },
      },
    ])
    expect(JSON.stringify(command)).not.toContain('SECRET_OUTPUT')

    const tool = normalizeCodexEvent({
      type: 'item.completed',
      item: {
        id: 't1',
        type: 'mcp_tool_call',
        server: 'github',
        tool: 'search',
        arguments: { token: 'DO_NOT_LEAK' },
        result: { secret: 'DO_NOT_LEAK' },
        status: 'completed',
      },
    })
    expect(JSON.stringify(tool)).not.toContain('DO_NOT_LEAK')
  })

  it('redacts common credential-looking values in runtime errors', () => {
    const message = sanitizeErrorMessage(
      'request failed: Bearer abc.DEF-123 token-supersecretvalue12345',
    )

    expect(message).toContain('Bearer [redacted]')
    expect(message).not.toContain('supersecretvalue12345')
  })
})
