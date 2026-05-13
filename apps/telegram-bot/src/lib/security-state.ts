/**
 * Per-user security toggles persisted in `WALLET_KV` and consumed by
 * `/security` and any future flow that gates on them (withdraw will be
 * the first such consumer once it ships). Pure storage layer — all
 * interactive logic lives in `commands/security.ts`.
 *
 * Withdrawal-lock semantics (AGENTS.md `/security`):
 *   - Enabling is instant.
 *   - Disabling requires a 24-hour cooldown: the user submits a request,
 *     and only after 24 hours have elapsed does a second `disable` call
 *     actually clear the lock. The delay mirrors the PIN-reset delay so
 *     a stolen Telegram session cannot instantly drain funds.
 *   - Cancelling the pending disable wipes the request timestamp without
 *     touching the enabled flag.
 *
 * Anti-phishing phrase lives on the grammY session (see `bot.ts ::
 * SessionData.antiPhishingPhrase`); we deliberately do not re-store it
 * here. `commands/security.ts` reads/writes it directly via `ctx.session`.
 */

const lockKey = (userId: number): string => `security:${userId}:withdraw-lock`;

const DISABLE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

interface StoredLockState {
  enabled: boolean;
  /** ms epoch when [Disable] was tapped; null when no disable is pending. */
  disableRequestedAt: number | null;
}

const EMPTY: StoredLockState = { enabled: false, disableRequestedAt: null };

export type DisableResult =
  | { kind: "disabled" }
  | { kind: "pending"; readyAt: number }
  | { kind: "not-enabled" };

export class SecurityState {
  private readonly now: () => number;

  constructor(
    private readonly kv: KVNamespace,
    options: { now?: () => number } = {},
  ) {
    this.now = options.now ?? (() => Date.now());
  }

  async getWithdrawLock(userId: number): Promise<StoredLockState> {
    const raw = await this.kv.get(lockKey(userId));
    if (!raw) return { ...EMPTY };
    return JSON.parse(raw) as StoredLockState;
  }

  async enableWithdrawLock(userId: number): Promise<void> {
    const next: StoredLockState = { enabled: true, disableRequestedAt: null };
    await this.kv.put(lockKey(userId), JSON.stringify(next));
  }

  /**
   * Two-phase disable: the first call records the request and returns a
   * `pending` result with the unlock time; the second call after 24h
   * actually clears the flag. Calling on an already-not-enabled lock
   * returns `not-enabled` without touching KV.
   */
  async requestDisableWithdrawLock(userId: number): Promise<DisableResult> {
    const state = await this.getWithdrawLock(userId);
    if (!state.enabled) return { kind: "not-enabled" };
    if (state.disableRequestedAt !== null) {
      const readyAt = state.disableRequestedAt + DISABLE_COOLDOWN_MS;
      if (this.now() >= readyAt) {
        const next: StoredLockState = {
          enabled: false,
          disableRequestedAt: null,
        };
        await this.kv.put(lockKey(userId), JSON.stringify(next));
        return { kind: "disabled" };
      }
      return { kind: "pending", readyAt };
    }
    const requestedAt = this.now();
    const next: StoredLockState = {
      enabled: true,
      disableRequestedAt: requestedAt,
    };
    await this.kv.put(lockKey(userId), JSON.stringify(next));
    return { kind: "pending", readyAt: requestedAt + DISABLE_COOLDOWN_MS };
  }

  /** Cancel a pending disable without touching the enabled flag. */
  async cancelDisableWithdrawLock(userId: number): Promise<void> {
    const state = await this.getWithdrawLock(userId);
    if (!state.enabled || state.disableRequestedAt === null) return;
    const next: StoredLockState = { enabled: true, disableRequestedAt: null };
    await this.kv.put(lockKey(userId), JSON.stringify(next));
  }
}

export const WITHDRAW_LOCK_DISABLE_COOLDOWN_MS = DISABLE_COOLDOWN_MS;
