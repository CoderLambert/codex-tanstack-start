export type CodexRuntimeErrorCode =
  | "INVALID_INPUT"
  | "INVALID_WORKSPACE"
  | "AUTH_REQUIRED"
  | "RUNTIME_START_FAILED"
  | "CODEX_RUNTIME_FAILED";

export class CodexRuntimeError extends Error {
  readonly code: CodexRuntimeErrorCode;
  readonly cause?: unknown;

  constructor(code: CodexRuntimeErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "CodexRuntimeError";
    this.code = code;
    this.cause = cause;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown Codex runtime error";
}

export function normalizeCodexRuntimeError(error: unknown): CodexRuntimeError {
  if (error instanceof CodexRuntimeError) return error;

  const message = errorMessage(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes("not logged in") ||
    normalized.includes("login required") ||
    normalized.includes("authentication") ||
    normalized.includes("unauthorized") ||
    normalized.includes("401")
  ) {
    return new CodexRuntimeError(
      "AUTH_REQUIRED",
      "Codex is not authenticated. Sign in with the Codex CLI/ChatGPT account on the server host, then retry.",
      error,
    );
  }

  if (
    normalized.includes("enoent") ||
    normalized.includes("spawn") ||
    normalized.includes("executable") ||
    normalized.includes("permission denied")
  ) {
    return new CodexRuntimeError(
      "RUNTIME_START_FAILED",
      `Unable to start the Codex runtime: ${message}`,
      error,
    );
  }

  return new CodexRuntimeError("CODEX_RUNTIME_FAILED", message, error);
}
