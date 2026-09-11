import { CodexAppServerRuntime } from './codex-app-server.server'
import type {
  CodexRuntime,
  CodexRuntimeOptions,
  StreamCodexTurnInput,
} from './codex-runtime'

export type { CodexRuntime, CodexRuntimeOptions, StreamCodexTurnInput } from './codex-runtime'
export { CodexAppServerRuntime } from './codex-app-server.server'

let singleton: CodexRuntime | undefined

export function getCodexRuntime(options?: CodexRuntimeOptions): CodexRuntime {
  singleton ??= new CodexAppServerRuntime(options)
  return singleton
}
