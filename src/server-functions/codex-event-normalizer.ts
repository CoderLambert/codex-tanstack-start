import type {
  AgentActivity,
  AgentActivityKind,
  AgentActivityStatus,
  ChatEvent,
  ChatUsage,
} from '../features/chat/chat.types'
import type { CodexThreadEvent, CodexThreadItem, CodexUsage } from './codex-event.types'

/**
 * Converts Codex SDK events into the stable, browser-safe application contract.
 *
 * Security boundary:
 * - raw SDK objects are never forwarded
 * - command stdout/stderr is never forwarded
 * - MCP arguments/results are never forwarded
 * - reasoning text is not forwarded
 * - only an opaque thread identifier required for resume is exposed
 */
export function normalizeCodexEvent(event: CodexThreadEvent): ChatEvent[] {
  switch (event.type) {
    case 'thread.started':
      return [{ type: 'thread.started', threadId: event.thread_id }]

    case 'turn.started':
      return []

    case 'turn.completed':
      return [{ type: 'turn.completed', usage: normalizeUsage(event.usage) }]

    case 'turn.failed':
      return [{ type: 'error', message: sanitizeErrorMessage(event.error.message) }]

    case 'error':
      return [{ type: 'error', message: sanitizeErrorMessage(event.message) }]

    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      return normalizeItemEvent(event.type, event.item)
  }
}

function normalizeItemEvent(
  eventType: 'item.started' | 'item.updated' | 'item.completed',
  item: CodexThreadItem,
): ChatEvent[] {
  if (item.type === 'agent_message') {
    return eventType === 'item.completed'
      ? [{ type: 'assistant.message', id: item.id, text: item.text }]
      : []
  }

  const normalizedActivity = toActivity(item)
  if (!normalizedActivity) {
    return []
  }

  const activity =
    eventType === 'item.completed' && normalizedActivity.status === 'running'
      ? { ...normalizedActivity, status: 'completed' as const }
      : normalizedActivity

  if (eventType === 'item.started') {
    return [{ type: 'activity.started', activity }]
  }

  if (eventType === 'item.updated') {
    return [{ type: 'activity.updated', activity }]
  }

  return [{ type: 'activity.completed', activity }]
}

function toActivity(item: Exclude<CodexThreadItem, { type: 'agent_message' }>): AgentActivity | null {
  switch (item.type) {
    case 'reasoning':
      return activity(item.id, 'reasoning', 'running', 'Reasoning')

    case 'command_execution':
      return activity(
        item.id,
        'command',
        mapRuntimeStatus(item.status),
        summarizeCommand(item.command),
      )

    case 'file_change':
      return activity(
        item.id,
        'file',
        item.status === 'failed' ? 'failed' : 'completed',
        `File changes: ${item.changes.length}`,
      )

    case 'mcp_tool_call':
      return activity(
        item.id,
        'tool',
        mapRuntimeStatus(item.status),
        `Tool: ${safeLabel(item.server)} / ${safeLabel(item.tool)}`,
      )

    case 'web_search':
      return activity(item.id, 'web', 'completed', 'Web search')

    case 'todo_list': {
      const completed = item.items.filter((todo) => todo.completed).length
      return activity(item.id, 'todo', 'running', `Plan progress: ${completed}/${item.items.length}`)
    }

    case 'error':
      return activity(item.id, 'error', 'failed', sanitizeErrorMessage(item.message))
  }
}

function activity(
  id: string,
  kind: AgentActivityKind,
  status: AgentActivityStatus,
  summary: string,
): AgentActivity {
  return { id, kind, status, summary }
}

function mapRuntimeStatus(status: 'in_progress' | 'completed' | 'failed'): AgentActivityStatus {
  if (status === 'in_progress') return 'running'
  return status
}

function normalizeUsage(usage: CodexUsage): ChatUsage {
  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    cacheWriteInputTokens: usage.cache_write_input_tokens ?? 0,
    outputTokens: usage.output_tokens,
    reasoningOutputTokens: usage.reasoning_output_tokens,
  }
}

function summarizeCommand(command: string): string {
  const executable = command.trim().split(/\s+/u, 1)[0]
  if (!executable) return 'Command'
  const basename = executable.split(/[\\/]/u).at(-1) ?? executable
  return `Command: ${safeLabel(basename)}`
}

function safeLabel(value: string): string {
  return value.replace(/[\r\n\t]/gu, ' ').slice(0, 120)
}

export function sanitizeErrorMessage(message: string): string {
  const normalized = message.replace(/[\r\n\t]+/gu, ' ').trim()
  const redacted = normalized
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [redacted]')
    .replace(/\b(?:sk|sess|session|token)[-_][A-Za-z0-9._-]{12,}\b/giu, '[redacted]')

  return redacted.slice(0, 500) || 'Codex turn failed.'
}
