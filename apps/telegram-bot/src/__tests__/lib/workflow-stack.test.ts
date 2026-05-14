import { describe, expect, it, vi } from "vitest";

import {
  clearWorkflowMessages,
  getWorkflowMessages,
  pushWorkflowMessage,
  removeWorkflowMessage,
  type WorkflowStackSession,
} from "../../lib/workflow-stack.js";

const makeApi = (impl?: (chatId: number, id: number) => Promise<unknown>) => ({
  deleteMessage: vi.fn(impl ?? (async () => true)),
});

describe("pushWorkflowMessage", () => {
  it("appends a (chatId, messageId) pair to the session stack", () => {
    const session: WorkflowStackSession = {};
    pushWorkflowMessage(session, 5, 101);
    pushWorkflowMessage(session, 5, 102);
    expect(session.workflowMessages).toEqual([
      { chatId: 5, messageId: 101 },
      { chatId: 5, messageId: 102 },
    ]);
  });

  it("is idempotent for repeat (chatId, messageId) pairs", () => {
    const session: WorkflowStackSession = {};
    pushWorkflowMessage(session, 5, 101);
    pushWorkflowMessage(session, 5, 101);
    pushWorkflowMessage(session, 5, 102);
    pushWorkflowMessage(session, 5, 101);
    expect(session.workflowMessages).toEqual([
      { chatId: 5, messageId: 101 },
      { chatId: 5, messageId: 102 },
    ]);
  });

  it("treats the same messageId in different chats as distinct entries", () => {
    const session: WorkflowStackSession = {};
    pushWorkflowMessage(session, 5, 101);
    pushWorkflowMessage(session, 9, 101);
    expect(session.workflowMessages).toEqual([
      { chatId: 5, messageId: 101 },
      { chatId: 9, messageId: 101 },
    ]);
  });

  it("initialises the stack lazily on first push", () => {
    const session: WorkflowStackSession = {};
    expect(session.workflowMessages).toBeUndefined();
    pushWorkflowMessage(session, 1, 7);
    expect(Array.isArray(session.workflowMessages)).toBe(true);
  });
});

describe("getWorkflowMessages", () => {
  it("returns a deep-copied snapshot — mutation does not leak into session", () => {
    const session: WorkflowStackSession = {
      workflowMessages: [
        { chatId: 1, messageId: 1 },
        { chatId: 1, messageId: 2 },
      ],
    };
    const snapshot = getWorkflowMessages(session);
    snapshot[0]!.messageId = 999;
    snapshot.push({ chatId: 2, messageId: 50 });
    expect(session.workflowMessages).toEqual([
      { chatId: 1, messageId: 1 },
      { chatId: 1, messageId: 2 },
    ]);
  });

  it("returns [] for an empty session", () => {
    expect(getWorkflowMessages({})).toEqual([]);
  });
});

describe("legacy session shape normalisation", () => {
  // The workflow stack originally shipped as `number[]`; the schema
  // moved to `{chatId, messageId}[]` once per-chat scoping landed.
  // Sessions persisted under the old shape must not poison the new
  // reads — entries without a chatId are dropped (their chat is
  // unknowable) and the rest is normalised through the same code path.
  it("drops legacy bare-number entries on push", () => {
    const session = {
      workflowMessages: [1, 2, 3] as unknown,
    } as WorkflowStackSession;
    pushWorkflowMessage(session, 5, 100);
    expect(session.workflowMessages).toEqual([{ chatId: 5, messageId: 100 }]);
  });

  it("drops legacy entries when clearing", async () => {
    const session = {
      workflowMessages: [
        1,
        { chatId: 5, messageId: 10 },
        2,
        { chatId: 9, messageId: 11 },
        3,
      ] as unknown,
    } as WorkflowStackSession;
    const api = makeApi();
    await clearWorkflowMessages(session, api, 5);
    // Only the chat=5 entry is deleted; legacy numbers are silently
    // dropped; the chat=9 entry survives.
    expect(api.deleteMessage).toHaveBeenCalledTimes(1);
    expect(api.deleteMessage).toHaveBeenCalledWith(5, 10);
    expect(session.workflowMessages).toEqual([{ chatId: 9, messageId: 11 }]);
  });

  it("drops legacy entries via getWorkflowMessages without mutating session further", () => {
    const session = {
      workflowMessages: [
        1,
        { chatId: 5, messageId: 10 },
        null,
        { chatId: 5, messageId: 11 },
      ] as unknown,
    } as WorkflowStackSession;
    expect(getWorkflowMessages(session)).toEqual([
      { chatId: 5, messageId: 10 },
      { chatId: 5, messageId: 11 },
    ]);
    expect(session.workflowMessages).toEqual([
      { chatId: 5, messageId: 10 },
      { chatId: 5, messageId: 11 },
    ]);
  });
});

describe("clearWorkflowMessages", () => {
  it("calls deleteMessage for every tracked id in the target chat and drops them from the stack", async () => {
    const session: WorkflowStackSession = {
      workflowMessages: [
        { chatId: 42, messageId: 10 },
        { chatId: 42, messageId: 11 },
        { chatId: 42, messageId: 12 },
      ],
    };
    const api = makeApi();
    await clearWorkflowMessages(session, api, 42);
    expect(api.deleteMessage).toHaveBeenCalledTimes(3);
    expect(api.deleteMessage).toHaveBeenCalledWith(42, 10);
    expect(api.deleteMessage).toHaveBeenCalledWith(42, 11);
    expect(api.deleteMessage).toHaveBeenCalledWith(42, 12);
    expect(session.workflowMessages).toEqual([]);
  });

  it("only sweeps the target chat's ids — entries from other chats survive", async () => {
    const session: WorkflowStackSession = {
      workflowMessages: [
        { chatId: 42, messageId: 10 },
        { chatId: 99, messageId: 11 },
        { chatId: 42, messageId: 12 },
        { chatId: 99, messageId: 13 },
      ],
    };
    const api = makeApi();
    await clearWorkflowMessages(session, api, 42);
    expect(api.deleteMessage).toHaveBeenCalledTimes(2);
    expect(api.deleteMessage).toHaveBeenCalledWith(42, 10);
    expect(api.deleteMessage).toHaveBeenCalledWith(42, 12);
    expect(api.deleteMessage).not.toHaveBeenCalledWith(99, 11);
    expect(api.deleteMessage).not.toHaveBeenCalledWith(99, 13);
    expect(session.workflowMessages).toEqual([
      { chatId: 99, messageId: 11 },
      { chatId: 99, messageId: 13 },
    ]);
  });

  it("is a no-op when the stack is empty", async () => {
    const session: WorkflowStackSession = {};
    const api = makeApi();
    await clearWorkflowMessages(session, api, 1);
    expect(api.deleteMessage).not.toHaveBeenCalled();
    expect(session.workflowMessages).toEqual([]);
  });

  it("does not call deleteMessage when no entries match the target chat", async () => {
    const session: WorkflowStackSession = {
      workflowMessages: [
        { chatId: 1, messageId: 1 },
        { chatId: 2, messageId: 2 },
      ],
    };
    const api = makeApi();
    await clearWorkflowMessages(session, api, 99);
    expect(api.deleteMessage).not.toHaveBeenCalled();
    expect(session.workflowMessages).toEqual([
      { chatId: 1, messageId: 1 },
      { chatId: 2, messageId: 2 },
    ]);
  });

  it("swallows deleteMessage errors so one stale id can't block cleanup", async () => {
    const session: WorkflowStackSession = {
      workflowMessages: [
        { chatId: 5, messageId: 1 },
        { chatId: 5, messageId: 2 },
        { chatId: 5, messageId: 3 },
      ],
    };
    const api = makeApi(async (_chat, id) => {
      if (id === 2) throw new Error("message to delete not found");
      return true;
    });
    await expect(
      clearWorkflowMessages(session, api, 5),
    ).resolves.toBeUndefined();
    expect(api.deleteMessage).toHaveBeenCalledTimes(3);
    expect(session.workflowMessages).toEqual([]);
  });

  it("drops target-chat entries from the stack even if every delete throws", async () => {
    const session: WorkflowStackSession = {
      workflowMessages: [
        { chatId: 9, messageId: 1 },
        { chatId: 9, messageId: 2 },
        { chatId: 7, messageId: 3 },
      ],
    };
    const api = makeApi(async () => {
      throw new Error("forbidden");
    });
    await clearWorkflowMessages(session, api, 9);
    expect(session.workflowMessages).toEqual([{ chatId: 7, messageId: 3 }]);
  });
});

describe("removeWorkflowMessage", () => {
  it("removes only the matching (chatId, messageId) entry", () => {
    const session: WorkflowStackSession = {
      workflowMessages: [
        { chatId: 5, messageId: 10 },
        { chatId: 5, messageId: 11 },
        { chatId: 9, messageId: 11 },
      ],
    };
    removeWorkflowMessage(session, 5, 11);
    expect(session.workflowMessages).toEqual([
      { chatId: 5, messageId: 10 },
      { chatId: 9, messageId: 11 },
    ]);
  });

  it("is a no-op when the entry is absent", () => {
    const session: WorkflowStackSession = {
      workflowMessages: [{ chatId: 1, messageId: 1 }],
    };
    removeWorkflowMessage(session, 99, 99);
    expect(session.workflowMessages).toEqual([{ chatId: 1, messageId: 1 }]);
  });

  it("is a no-op on an empty session", () => {
    const session: WorkflowStackSession = {};
    removeWorkflowMessage(session, 1, 1);
    expect(session.workflowMessages).toEqual([]);
  });
});
