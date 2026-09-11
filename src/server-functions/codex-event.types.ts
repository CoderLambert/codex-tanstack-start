/**
 * Deliberately small structural mirror of the server-side Codex event contract.
 *
 * Browser-reachable modules never import Codex SDK or app-server protocol types.
 * The runtime adapter converts server notifications into these shapes first.
 */
export type CodexUsage = {
  input_tokens: number
  cached_input_tokens: number
  cache_write_input_tokens?: number
  output_tokens: number
  reasoning_output_tokens: number
}

export type CodexThreadItem =
  | {
      id: string
      type: 'agent_message'
      text: string
    }
  | {
      id: string
      type: 'reasoning'
      text: string
    }
  | {
      id: string
      type: 'command_execution'
      command: string
      aggregated_output: string
      exit_code?: number
      status: 'in_progress' | 'completed' | 'failed'
    }
  | {
      id: string
      type: 'file_change'
      changes: Array<{ path: string; kind: 'add' | 'delete' | 'update' }>
      status: 'completed' | 'failed'
    }
  | {
      id: string
      type: 'mcp_tool_call'
      server: string
      tool: string
      arguments: unknown
      result?: unknown
      error?: { message: string }
      status: 'in_progress' | 'completed' | 'failed'
    }
  | {
      id: string
      type: 'web_search'
      query: string
    }
  | {
      id: string
      type: 'todo_list'
      items: Array<{ text: string; completed: boolean }>
    }
  | {
      id: string
      type: 'error'
      message: string
    }

export type CodexThreadEvent =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'turn.started' }
  | { type: 'turn.completed'; usage: CodexUsage }
  | { type: 'turn.failed'; error: { message: string } }
  | { type: 'item.started'; item: CodexThreadItem }
  | { type: 'item.updated'; item: CodexThreadItem }
  | { type: 'item.completed'; item: CodexThreadItem }
  | { type: 'item.agent_message.delta'; item_id: string; delta: string }
  | { type: 'error'; message: string }
