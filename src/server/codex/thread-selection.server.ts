import { CodexRuntimeError } from "./codex.errors";

export type ThreadOptionsLike = {
  sandboxMode: "read-only";
  workingDirectory: string;
  approvalPolicy: "never";
  networkAccessEnabled: false;
};

export type CodexThreadLike<TEvent = unknown> = {
  readonly id: string | null;
  runStreamed(
    input: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ events: AsyncGenerator<TEvent> }>;
};

export type CodexClientLike<TEvent = unknown> = {
  startThread(options: ThreadOptionsLike): CodexThreadLike<TEvent>;
  resumeThread(threadId: string, options: ThreadOptionsLike): CodexThreadLike<TEvent>;
};

const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export function normalizeThreadId(threadId?: string | null): string | undefined {
  if (threadId == null) return undefined;

  const normalized = threadId.trim();
  if (!normalized) return undefined;

  if (!THREAD_ID_PATTERN.test(normalized)) {
    throw new CodexRuntimeError("INVALID_INPUT", "Invalid Codex thread id.");
  }

  return normalized;
}

export function selectThread<TEvent>(
  client: CodexClientLike<TEvent>,
  threadId: string | undefined,
  options: ThreadOptionsLike,
): CodexThreadLike<TEvent> {
  return threadId ? client.resumeThread(threadId, options) : client.startThread(options);
}
