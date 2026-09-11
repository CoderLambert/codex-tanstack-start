import { describe, expect, it } from 'vitest'
import { normalizeCodexEvent, sanitizeErrorMessage } from '../codex-event-normalizer'

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

  it('emits assistant text only when the item completes', () => {
    const item = { id: 'm1', type: 'agent_message' as const, text: 'Hello' }

    expect(normalizeCodexEvent({ type: 'item.updated', item })).toEqual([])
    expect(normalizeCodexEvent({ type: 'item.completed', item })).toEqual([
      { type: 'assistant.message', id: 'm1', text: 'Hello' },
    ])
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
