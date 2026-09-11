import { describe, expect, it, vi } from "vitest";

import {
  normalizeThreadId,
  selectThread,
  type CodexClientLike,
  type CodexThreadLike,
  type ThreadOptionsLike,
} from "./thread-selection.server";

function fakeThread(id: string | null): CodexThreadLike {
  return {
    id,
    async runStreamed() {
      async function* events() {
        // no-op fake stream
      }
      return { events: events() };
    },
  };
}

const options: ThreadOptionsLike = {
  sandboxMode: "read-only",
  approvalPolicy: "never",
  networkAccessEnabled: false,
  workingDirectory: "/workspace",
};

describe("normalizeThreadId", () => {
  it("treats missing and blank ids as a new thread", () => {
    expect(normalizeThreadId()).toBeUndefined();
    expect(normalizeThreadId("   ")).toBeUndefined();
  });

  it("trims a valid id", () => {
    expect(normalizeThreadId("  abc-123  ")).toBe("abc-123");
  });

  it("rejects malformed ids", () => {
    expect(() => normalizeThreadId("../session")).toThrow("Invalid Codex thread id");
  });
});

describe("selectThread", () => {
  it("starts a new thread when no id is present", () => {
    const started = fakeThread(null);
    const client: CodexClientLike = {
      startThread: vi.fn(() => started),
      resumeThread: vi.fn(() => fakeThread("unused")),
    };

    expect(selectThread(client, undefined, options)).toBe(started);
    expect(client.startThread).toHaveBeenCalledWith(options);
    expect(client.resumeThread).not.toHaveBeenCalled();
  });

  it("resumes the requested thread", () => {
    const resumed = fakeThread("thread-123");
    const client: CodexClientLike = {
      startThread: vi.fn(() => fakeThread(null)),
      resumeThread: vi.fn(() => resumed),
    };

    expect(selectThread(client, "thread-123", options)).toBe(resumed);
    expect(client.resumeThread).toHaveBeenCalledWith("thread-123", options);
    expect(client.startThread).not.toHaveBeenCalled();
  });
});
