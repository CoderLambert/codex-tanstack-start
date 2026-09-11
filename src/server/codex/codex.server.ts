import { Codex, type ThreadEvent } from "@openai/codex-sdk";

import { CodexRuntimeError, normalizeCodexRuntimeError } from "./codex.errors";
import {
  normalizeThreadId,
  selectThread,
  type CodexClientLike,
  type ThreadOptionsLike,
} from "./thread-selection.server";
import { resolveWorkspace } from "./workspace.server";

export type StreamCodexTurnInput = {
  prompt: string;
  threadId?: string | null;
  workspacePath?: string;
  signal?: AbortSignal;
};

export type CodexRuntimeOptions = {
  workspaceRoot?: string;
};

const LUNA_HIGH_THREAD_OPTIONS = {
  model: "luna",
  modelReasoningEffort: "high",
  sandboxMode: "read-only",
  approvalPolicy: "never",
  networkAccessEnabled: false,
} as const;

function normalizePrompt(prompt: string): string {
  const normalized = prompt.trim();
  if (!normalized) {
    throw new CodexRuntimeError("INVALID_INPUT", "Prompt must not be empty.");
  }
  return normalized;
}

/**
 * Server-only wrapper around @openai/codex-sdk.
 *
 * Authentication is intentionally not accepted from the browser. The SDK reuses
 * the Codex/ChatGPT authentication available to the server-side Codex runtime.
 */
export class CodexRuntime {
  private readonly client: CodexClientLike<ThreadEvent>;
  private readonly workspaceRoot?: string;

  constructor(options: CodexRuntimeOptions = {}, client?: CodexClientLike<ThreadEvent>) {
    this.workspaceRoot = options.workspaceRoot;
    this.client = client ?? (new Codex() as CodexClientLike<ThreadEvent>);
  }

  async *streamTurn(input: StreamCodexTurnInput): AsyncGenerator<ThreadEvent> {
    const prompt = normalizePrompt(input.prompt);
    const threadId = normalizeThreadId(input.threadId);
    const workingDirectory = await resolveWorkspace({
      requestedPath: input.workspacePath,
      allowedRoot: this.workspaceRoot,
    });

    const threadOptions: ThreadOptionsLike = {
      ...LUNA_HIGH_THREAD_OPTIONS,
      workingDirectory,
    };

    const thread = selectThread(this.client, threadId, threadOptions);

    try {
      const { events } = await thread.runStreamed(prompt, { signal: input.signal });
      for await (const event of events) {
        yield event;
      }
    } catch (error) {
      throw normalizeCodexRuntimeError(error);
    }
  }
}

let singleton: CodexRuntime | undefined;

export function getCodexRuntime(): CodexRuntime {
  singleton ??= new CodexRuntime();
  return singleton;
}
