import { describe, expect, it } from 'vitest'
import {
  normalizeAppServerNotification,
} from './codex-app-server.server'

const usage = {
  value: {
    input_tokens: 1,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 2,
    reasoning_output_tokens: 0,
  },
}

describe('normalizeAppServerNotification', () => {
  it('preserves the assistant lifecycle and delta sequence', () => {
    expect(normalizeAppServerNotification({
      method: 'item/started',
      params: {
        item: {
          type: 'agentMessage',
          id: 'm1',
          text: '',
        },
      },
    }, usage)).toEqual([
      { type: 'item.started', item: { id: 'm1', type: 'agent_message', text: '' } },
    ])

    expect(normalizeAppServerNotification({
      method: 'item/agentMessage/delta',
      params: { itemId: 'm1', delta: 'Hello' },
    }, usage)).toEqual([
      { type: 'item.agent_message.delta', item_id: 'm1', delta: 'Hello' },
    ])

    expect(normalizeAppServerNotification({
      method: 'item/completed',
      params: {
        item: {
          type: 'agentMessage',
          id: 'm1',
          text: 'Hello',
        },
      },
    }, usage)).toEqual([
      { type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'Hello' } },
    ])
  })

  it('does not carry MCP arguments or results across the runtime boundary', () => {
    const events = normalizeAppServerNotification({
      method: 'item/completed',
      params: {
        item: {
          type: 'mcpToolCall',
          id: 'tool-1',
          server: 'github',
          tool: 'search',
          arguments: { token: 'SECRET' },
          result: { secret: 'SECRET' },
          status: 'completed',
        },
      },
    }, usage)

    expect(JSON.stringify(events)).not.toContain('SECRET')
  })
})
