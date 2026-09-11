import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

import {
  CodexRuntimeError,
  normalizeCodexRuntimeError,
} from './codex.errors'
import { normalizeThreadId } from './thread-selection.server'
import { resolveWorkspace } from './workspace.server'
import type {
  CodexRuntime,
  CodexRuntimeOptions,
  StreamCodexTurnInput,
} from './codex-runtime'
import type {
  CodexThreadEvent,
  CodexThreadItem,
  CodexUsage,
} from '../../server-functions/codex-event.types'

const LUNA_HIGH_OPTIONS = {
  model: 'luna',
  effort: 'high',
  approvalPolicy: 'never',
  sandbox: 'read-only',
  sandboxPolicy: { type: 'readOnly', networkAccess: false },
} as const

type JsonRecord = Record<string, unknown>

type AppServerMessage = JsonRecord & {
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: unknown
}

type AppServerRequestResult = {
  response: AppServerMessage
  notifications: AppServerMessage[]
}

type UsageState = { value: CodexUsage }

const EMPTY_USAGE: CodexUsage = {
  input_tokens: 0,
  cached_input_tokens: 0,
  cache_write_input_tokens: 0,
  output_tokens: 0,
  reasoning_output_tokens: 0,
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function normalizePrompt(prompt: string): string {
  const normalized = prompt.trim()
  if (!normalized) {
    throw new CodexRuntimeError('INVALID_INPUT', 'Prompt must not be empty.')
  }
  return normalized
}

function rpcErrorMessage(error: unknown): string {
  if (isRecord(error)) {
    const message = stringValue(error.message)
    if (message) return message
  }
  return 'Codex app-server request failed.'
}

function appServerErrorMessage(message: AppServerMessage): string {
  const params = isRecord(message.params) ? message.params : null
  const error = params && isRecord(params.error) ? params.error : null
  return stringValue(error?.message) ?? 'Codex app-server reported an error.'
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function mapUsage(value: unknown): CodexUsage | null {
  if (!isRecord(value)) return null
  return {
    input_tokens: numberValue(value.inputTokens),
    cached_input_tokens: numberValue(value.cachedInputTokens),
    cache_write_input_tokens: numberValue(value.cacheWriteInputTokens),
    output_tokens: numberValue(value.outputTokens),
    reasoning_output_tokens: numberValue(value.reasoningOutputTokens),
  }
}

function mapRuntimeStatus(value: unknown): 'in_progress' | 'completed' | 'failed' {
  if (value === 'inProgress') return 'in_progress'
  if (value === 'failed' || value === 'declined') return 'failed'
  return 'completed'
}

function mapFileChangeKind(value: unknown): 'add' | 'delete' | 'update' {
  if (isRecord(value) && (value.type === 'add' || value.type === 'delete')) {
    return value.type
  }
  return 'update'
}

function mapAppServerItem(value: unknown): CodexThreadItem | null {
  if (!isRecord(value)) return null
  const id = stringValue(value.id)
  const type = stringValue(value.type)
  if (!id || !type) return null

  switch (type) {
    case 'agentMessage': {
      return { id, type: 'agent_message', text: stringValue(value.text) ?? '' }
    }

    case 'reasoning': {
      const summary = Array.isArray(value.summary)
        ? value.summary.filter((item): item is string => typeof item === 'string')
        : []
      return { id, type: 'reasoning', text: summary.join('\n') }
    }

    case 'commandExecution': {
      const command = stringValue(value.command)
      if (!command) return null
      return {
        id,
        type: 'command_execution',
        command,
        aggregated_output: stringValue(value.aggregatedOutput) ?? '',
        exit_code: typeof value.exitCode === 'number' ? value.exitCode : undefined,
        status: mapRuntimeStatus(value.status),
      }
    }

    case 'fileChange': {
      const changes = Array.isArray(value.changes)
        ? value.changes.flatMap((change) => {
            if (!isRecord(change) || typeof change.path !== 'string') return []
            return [{ path: change.path, kind: mapFileChangeKind(change.kind) }]
          })
        : []
      return {
        id,
        type: 'file_change',
        changes,
        status: value.status === 'failed' || value.status === 'declined' ? 'failed' : 'completed',
      }
    }

    case 'mcpToolCall': {
      const server = stringValue(value.server)
      const tool = stringValue(value.tool)
      if (!server || !tool) return null
      return {
        id,
        type: 'mcp_tool_call',
        server,
        tool,
        arguments: undefined,
        result: undefined,
        error: undefined,
        status: mapRuntimeStatus(value.status),
      }
    }

    case 'webSearch':
      return {
        id,
        type: 'web_search',
        query: stringValue(value.query) ?? 'Web search',
      }

    case 'error': {
      const message = stringValue(value.message)
      return message === null ? null : { id, type: 'error', message }
    }

    default:
      return null
  }
}

class AppServerConnection {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly lines
  private readonly messages
  private requestId = 0
  private stderr = ''

  constructor(codexPath: string) {
    this.child = spawn(codexPath, ['app-server', '--stdio'], {
      cwd: process.cwd(),
      stdio: 'pipe',
    })
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk: string) => {
      this.stderr += chunk
    })
    this.lines = createInterface({ input: this.child.stdout })
    this.messages = this.lines[Symbol.asyncIterator]()
  }

  send(method: string, params: unknown): number {
    if (this.child.stdin.destroyed) {
      throw new Error('Codex app-server stdin is closed.')
    }
    const id = ++this.requestId
    this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    return id
  }

  notify(method: string, params?: unknown): void {
    if (this.child.stdin.destroyed) return
    this.child.stdin.write(`${JSON.stringify({ method, ...(params === undefined ? {} : { params }) })}\n`)
  }

  async request(method: string, params: unknown): Promise<AppServerRequestResult> {
    const id = this.send(method, params)
    const notifications: AppServerMessage[] = []

    while (true) {
      const message = await this.nextMessage()
      if (message.id === id) {
        if (message.error !== undefined) {
          throw new Error(rpcErrorMessage(message.error))
        }
        return { response: message, notifications }
      }

      if (this.isServerRequest(message)) {
        this.rejectServerRequest(message)
      } else if (message.method) {
        notifications.push(message)
      }
    }
  }

  async nextNotification(): Promise<AppServerMessage> {
    while (true) {
      const message = await this.nextMessage()
      if (this.isServerRequest(message)) {
        this.rejectServerRequest(message)
        continue
      }
      return message
    }
  }

  async close(): Promise<void> {
    this.lines.close()
    if (this.child.exitCode !== null) return

    await new Promise<void>((resolve) => {
      const finish = () => resolve()
      this.child.once('exit', finish)
      this.child.kill()
    })
  }

  private async nextMessage(): Promise<AppServerMessage> {
    const next = await this.messages.next()
    if (next.done) {
      const detail = this.stderr.trim()
      throw new Error(detail ? `Codex app-server exited: ${detail}` : 'Codex app-server exited unexpectedly.')
    }

    try {
      const parsed: unknown = JSON.parse(next.value)
      if (!isRecord(parsed)) throw new Error('Codex app-server returned a non-object message.')
      return parsed as AppServerMessage
    } catch (error) {
      throw new Error(`Invalid Codex app-server message: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }

  private isServerRequest(message: AppServerMessage): boolean {
    return message.id !== undefined && message.method !== undefined && message.result === undefined && message.error === undefined
  }

  private rejectServerRequest(message: AppServerMessage): void {
    if (message.id === undefined || this.child.stdin.destroyed) return
    this.child.stdin.write(`${JSON.stringify({
      id: message.id,
      error: { code: -32000, message: 'Interactive server requests are disabled.' },
    })}\n`)
  }
}

function threadIdFromResponse(response: AppServerMessage): string {
  const result = isRecord(response.result) ? response.result : null
  const thread = result && isRecord(result.thread) ? result.thread : null
  const threadId = thread && stringValue(thread.id)
  if (!threadId) throw new Error('Codex app-server did not return a thread id.')
  return threadId
}

function notificationEvents(
  message: AppServerMessage,
  usage: UsageState,
): CodexThreadEvent[] {
  const params = isRecord(message.params) ? message.params : null
  if (!params || !message.method) return []

  switch (message.method) {
    case 'thread/started': {
      const thread = isRecord(params.thread) ? params.thread : null
      const threadId = thread && stringValue(thread.id)
      return threadId ? [{ type: 'thread.started', thread_id: threadId }] : []
    }

    case 'turn/started':
      return [{ type: 'turn.started' }]

    case 'item/started': {
      const item = mapAppServerItem(params.item)
      return item ? [{ type: 'item.started', item }] : []
    }

    case 'item/completed': {
      const item = mapAppServerItem(params.item)
      return item ? [{ type: 'item.completed', item }] : []
    }

    case 'item/agentMessage/delta': {
      const itemId = stringValue(params.itemId)
      const delta = stringValue(params.delta)
      return itemId && delta ? [{ type: 'item.agent_message.delta', item_id: itemId, delta }] : []
    }

    case 'thread/tokenUsage/updated': {
      const tokenUsage = isRecord(params.tokenUsage) ? params.tokenUsage : null
      const last = tokenUsage && mapUsage(tokenUsage.last)
      if (last) usage.value = last
      return []
    }

    case 'turn/completed': {
      const turn = isRecord(params.turn) ? params.turn : null
      const status = turn && stringValue(turn.status)
      if (status === 'failed' || status === 'interrupted') {
        const error = turn && isRecord(turn.error) ? turn.error : null
        return [{
          type: 'turn.failed',
          error: { message: stringValue(error?.message) ?? `Codex turn ${status}.` },
        }]
      }
      return [{ type: 'turn.completed', usage: usage.value }]
    }

    case 'error':
      return [{ type: 'error', message: appServerErrorMessage(message) }]

    default:
      return []
  }
}

export function normalizeAppServerNotification(
  message: unknown,
  usage: UsageState,
): CodexThreadEvent[] {
  return isRecord(message) ? notificationEvents(message as AppServerMessage, usage) : []
}

export class CodexAppServerRuntime implements CodexRuntime {
  private readonly workspaceRoot?: string
  private readonly codexPath: string

  constructor(options: CodexRuntimeOptions = {}) {
    this.workspaceRoot = options.workspaceRoot
    this.codexPath = options.codexPath ?? process.env.CODEX_APP_SERVER_PATH ?? 'codex'
  }

  async *streamTurn(input: StreamCodexTurnInput): AsyncGenerator<CodexThreadEvent> {
    const prompt = normalizePrompt(input.prompt)
    const threadId = normalizeThreadId(input.threadId)
    const workingDirectory = await resolveWorkspace({
      requestedPath: input.workspacePath,
      allowedRoot: this.workspaceRoot,
    })
    if (input.signal?.aborted) throw new Error('Codex turn was cancelled.')

    const connection = new AppServerConnection(this.codexPath)
    const abortHandler = () => connection.close().catch(() => undefined)
    input.signal?.addEventListener('abort', abortHandler, { once: true })

    try {
      await connection.request('initialize', {
        clientInfo: {
          name: 'codex-tanstack-demo',
          title: 'Codex TanStack Start Demo',
          version: '0.1.0',
        },
        capabilities: { experimentalApi: true, requestAttestation: false },
      })
      connection.notify('initialized')

      const threadRequest = threadId ? 'thread/resume' : 'thread/start'
      const threadResult = await connection.request(threadRequest, {
        ...(threadId ? { threadId } : {}),
        cwd: workingDirectory,
        model: LUNA_HIGH_OPTIONS.model,
        approvalPolicy: LUNA_HIGH_OPTIONS.approvalPolicy,
        sandbox: LUNA_HIGH_OPTIONS.sandbox,
      })
      const activeThreadId = threadIdFromResponse(threadResult.response)
      yield { type: 'thread.started', thread_id: activeThreadId }

      const turnResult = await connection.request('turn/start', {
        threadId: activeThreadId,
        input: [{ type: 'text', text: prompt }],
        cwd: workingDirectory,
        model: LUNA_HIGH_OPTIONS.model,
        effort: LUNA_HIGH_OPTIONS.effort,
        approvalPolicy: LUNA_HIGH_OPTIONS.approvalPolicy,
        sandboxPolicy: LUNA_HIGH_OPTIONS.sandboxPolicy,
      })
      const usage: UsageState = { value: { ...EMPTY_USAGE } }

      for (const message of turnResult.notifications) {
        for (const event of normalizeAppServerNotification(message, usage)) yield event
        if (message.method === 'turn/completed') return
      }

      while (true) {
        const message = await connection.nextNotification()
        for (const event of normalizeAppServerNotification(message, usage)) yield event
        if (message.method === 'turn/completed') return
      }
    } catch (error) {
      throw normalizeCodexRuntimeError(error)
    } finally {
      input.signal?.removeEventListener('abort', abortHandler)
      await connection.close()
    }
  }
}
