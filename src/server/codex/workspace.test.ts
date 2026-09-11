import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveWorkspace } from "./workspace.server";

describe("resolveWorkspace", () => {
  it("resolves a relative workspace inside the allowed root", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-runtime-"));
    await mkdir(join(root, "repo"));

    await expect(resolveWorkspace({ allowedRoot: root, requestedPath: "repo" })).resolves.toBe(
      join(root, "repo"),
    );
  });

  it("rejects paths outside the allowed root", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-runtime-root-"));
    const outside = await mkdtemp(join(tmpdir(), "codex-runtime-outside-"));

    await expect(resolveWorkspace({ allowedRoot: root, requestedPath: outside })).rejects.toMatchObject({
      code: "INVALID_WORKSPACE",
    });
  });

  it("rejects symlinks that escape the allowed root", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-runtime-root-"));
    const outside = await mkdtemp(join(tmpdir(), "codex-runtime-outside-"));
    await symlink(outside, join(root, "escape"));

    await expect(resolveWorkspace({ allowedRoot: root, requestedPath: "escape" })).rejects.toMatchObject({
      code: "INVALID_WORKSPACE",
    });
  });

  it("rejects files as workspaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-runtime-root-"));
    await writeFile(join(root, "file.txt"), "not a directory");

    await expect(resolveWorkspace({ allowedRoot: root, requestedPath: "file.txt" })).rejects.toMatchObject({
      code: "INVALID_WORKSPACE",
    });
  });
});
