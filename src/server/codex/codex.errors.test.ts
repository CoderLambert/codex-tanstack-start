import { describe, expect, it } from "vitest";

import { normalizeCodexRuntimeError } from "./codex.errors";

describe("normalizeCodexRuntimeError", () => {
  it("classifies authentication failures", () => {
    expect(normalizeCodexRuntimeError(new Error("401 Unauthorized"))).toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("classifies spawn failures", () => {
    expect(normalizeCodexRuntimeError(new Error("spawn codex ENOENT"))).toMatchObject({
      code: "RUNTIME_START_FAILED",
    });
  });
});
