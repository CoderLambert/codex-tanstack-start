export type ChatRequest = {
  message: string
  threadId?: string
}

export type ChatUsage = {
  inputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
}

export type AgentActivityKind =
  | 'reasoning'
  | 'command'
  | 'file'
  | 'tool'
  | 'web'
  | 'todo'
  | 'error'

export type AgentActivityStatus = 'running' | 'completed' | 'failed'

export type AgentActivity = {
  id: string
  kind: AgentActivityKind
  status: AgentActivityStatus
  summary: string
}

export type ChatEvent =
  | {
      type: 'thread.started'
      threadId: string
    }
  | {
      type: 'assistant.message'
      id: string
      text: string
    }
  | {
      type: 'activity.started'
      activity: AgentActivity
    }
  | {
      type: 'activity.updated'
      activity: AgentActivity
    }
  | {
      type: 'activity.completed'
      activity: AgentActivity
    }
  | {
      type: 'turn.completed'
      usage: ChatUsage
    }
  | {
      type: 'error'
      message: string
    }
