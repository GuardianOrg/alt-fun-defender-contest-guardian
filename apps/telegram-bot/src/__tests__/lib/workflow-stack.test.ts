import { describe, expect, it, vi } from "vitest";

import {
  clearWorkflowMessages,
  getWorkflowMessages,
  pushWorkflowMessage,
  type WorkflowStackSession,
} from "../../lib/workflow-stack.js";

const makeApi = (impl?: (chatId: number, id: number) => Promise<unknown>) => ({
  deleteMessage: vi.fn(impl ?? (async () => true)),
});

describe("pushWorkflowMessage", () => {
  it("appends a new id to the session stack", () => {
    const session: WorkflowStackSession = {};
    pushWorkflowMessage(session, 101);
    pushWorkflowMessage(session, 102);
    expect(session.workflowMessages).toEqual([101, 102]);
  });

  it("is idempotent for repeat ids — no duplicate deleteMessage on clear", () => {
    const session: WorkflowStackSession = {};
    pushWorkflowMessage(session, 101);
    pushWorkflowMessage(session, 101);
    pushWorkflowMessage(session, 102);
    pushWorkflowMessage(session, 101);
    expect(session.workflowMessages).toEqual([101, 102]);
  });

  it("initialises the stack lazily on first push", () => {
    const session: WorkflowStackSession = {};
    expect(session.workflowMessages).toBeUndefined();
    pushWorkflowMessage(session, 7);
    expect(Array.isArray(session.workflowMessages)).toBe(true);
  });
});

describe("getWorkflowMessages", () => {
  it("returns a defensive copy — mutation does not leak into session", () => {
    const session: WorkflowStackSession = { workflowMessages: [1, 2, 3] };
    const snapshot = getWorkflowMessages(session);
    snapshot.push(999);
    expect(session.workflowMessages).toEqual([1, 2, 3]);
  });

  it("returns [] for an empty session", () => {
    expect(getWorkflowMessages({})).toEqual([]);
  });
});

describe("clearWorkflowMessages", () => {
  it("calls deleteMessage for every tracked id and resets the stack", async () => {
    const session: WorkflowStackSession = { workflowMessages: [10, 11, 12] };
    const api = makeApi();
    await clearWorkflowMessages(session, api, 42);
    expect(api.deleteMessage).toHaveBeenCalledTimes(3);
    expect(api.deleteMessage).toHaveBeenCalledWith(42, 10);
    expect(api.deleteMessage).toHaveBeenCalledWith(42, 11);
    expect(api.deleteMessage).toHaveBeenCalledWith(42, 12);
    expect(session.workflowMessages).toEqual([]);
  });

  it("is a no-op when the stack is empty", async () => {
    const session: WorkflowStackSession = {};
    const api = makeApi();
    await clearWorkflowMessages(session, api, 1);
    expect(api.deleteMessage).not.toHaveBeenCalled();
    expect(session.workflowMessages).toEqual([]);
  });

  it("swallows deleteMessage errors so one stale id can't block cleanup", async () => {
    const session: WorkflowStackSession = { workflowMessages: [1, 2, 3] };
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

  it("resets the stack even if every delete throws", async () => {
    const session: WorkflowStackSession = { workflowMessages: [1, 2] };
    const api = makeApi(async () => {
      throw new Error("forbidden");
    });
    await clearWorkflowMessages(session, api, 9);
    expect(session.workflowMessages).toEqual([]);
  });
});
