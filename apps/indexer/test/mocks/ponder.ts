/**
 * Mock ponder registry that captures event handler registrations.
 * Handlers can be retrieved by event name and called with mock event/context.
 */
type Handler = (args: { event: unknown; context: unknown }) => Promise<void>;

const handlers = new Map<string, Handler>();

export const ponder = {
  on(eventName: string, handler: Handler) {
    handlers.set(eventName, handler);
  },
};

/** Retrieve a registered handler by event name for testing. */
export function getHandler(eventName: string): Handler {
  const handler = handlers.get(eventName);
  if (!handler) {
    throw new Error(
      `No handler registered for "${eventName}". Registered: ${[...handlers.keys()].join(", ")}`,
    );
  }
  return handler;
}

/**
 * List the names of every handler currently registered on the mock ponder.
 * Used by `single-handler-per-factory.test.ts` to lock the invariant that
 * factory-backed sources have exactly one indexing function — see that test
 * for the why (Ponder 0.16 real-time sync drops factory child addresses
 * when the factory is registered for ≥2 events).
 */
export function listHandlerNames(): string[] {
  return [...handlers.keys()];
}

/** Clear all registered handlers between test files. */
export function clearHandlers(): void {
  handlers.clear();
}
