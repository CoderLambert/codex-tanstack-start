import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { CodexRuntimeError } from "./codex.errors";

export type ResolveWorkspaceOptions = {
  requestedPath?: string;
  allowedRoot?: string;
};

async function realDirectory(path: string, label: string): Promise<string> {
  let canonicalPath: string;

  try {
    canonicalPath = await realpath(path);
  } catch (error) {
    throw new CodexRuntimeError(
      "INVALID_WORKSPACE",
      `${label} does not exist or cannot be resolved: ${path}`,
      error,
    );
  }

  const info = await stat(canonicalPath);
  if (!info.isDirectory()) {
    throw new CodexRuntimeError("INVALID_WORKSPACE", `${label} must be a directory: ${path}`);
  }

  return canonicalPath;
}

function isWithinRoot(candidate: string, root: string): boolean {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

/**
 * Resolve a user-selected workspace to a canonical server-side directory.
 *
 * V0 intentionally confines workspaces to CODEX_WORKSPACE_ROOT (or process.cwd())
 * so a browser request cannot point Codex at arbitrary host paths.
 */
export async function resolveWorkspace({
  requestedPath,
  allowedRoot = process.env.CODEX_WORKSPACE_ROOT ?? process.cwd(),
}: ResolveWorkspaceOptions = {}): Promise<string> {
  const canonicalRoot = await realDirectory(resolve(allowedRoot), "Codex workspace root");
  const rawCandidate = requestedPath?.trim() || canonicalRoot;
  const candidatePath = isAbsolute(rawCandidate)
    ? rawCandidate
    : resolve(canonicalRoot, rawCandidate);
  const canonicalCandidate = await realDirectory(candidatePath, "Codex workspace");

  if (!isWithinRoot(canonicalCandidate, canonicalRoot)) {
    throw new CodexRuntimeError(
      "INVALID_WORKSPACE",
      `Workspace must stay within the configured Codex workspace root: ${canonicalRoot}`,
    );
  }

  return canonicalCandidate;
}
