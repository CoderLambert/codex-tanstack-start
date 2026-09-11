import type { CodexThreadEvent } from '../../server-functions/codex-event.types'

export type StreamCodexTurnInput = {
  prompt: string
  threadId?: string | null
  workspacePath?: string
  signal?: AbortSignal
}

export type CodexRuntimeOptions = {
  workspaceRoot?: string
  codexPath?: string
}

/** Runtime boundary kept independent from the browser transport and UI. */
export interface CodexRuntime {
  streamTurn(input: StreamCodexTurnInput): AsyncGenerator<CodexThreadEvent>
}
