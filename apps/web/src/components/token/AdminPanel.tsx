import { useState } from "react";

import styles from "./AdminPanel.module.css";
import { useIsAdmin } from "../../hooks/useIsAdmin";
import { useTokenModeration } from "../../hooks/useTokenModeration";
import { getErrorMessage } from "../../utils/format";
import Button from "../shared/Button";
import Modal from "../shared/Modal";

import type { Token } from "../../services/types";

interface Props {
  token: Token;
}

/**
 * Admin moderation strip on the token detail page (issue #586).
 *
 * Renders ONLY when the connected wallet is in the moderation admin
 * allowlist resolved by the API. Lets an admin hide the token from the
 * public listings by signing the standard Alt Fun session message — the
 * same 24-hour signature is reused across actions and across the rest
 * of the app, so admins typically sign once per day total. The actual
 * gating happens server-side; this component is just the UI surface.
 *
 * v1 scope (per issue #586): hide-only. The detail endpoint enforces
 * `isHidden = false` for non-admin requests (matching listing / search /
 * batch / creator endpoints), so a hidden token's detail page returns
 * 404 to everyone — admins included. To restore a hidden token in v1,
 * use the `X-Admin-Key`-gated `POST /api/v1/admin/tokens/:address/unhide`
 * endpoint via ops tooling. A self-serve unhide UI (admin-only token
 * fetch + state-aware toggle) is tracked separately as a follow-up.
 */
export default function AdminPanel({ token }: Props) {
  const { isAdmin, isPending } = useIsAdmin();
  const { hide } = useTokenModeration(token.address);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (isPending || !isAdmin) return null;

  const handleConfirmHide = async () => {
    setError(null);
    setConfirmOpen(false);
    try {
      await hide.mutateAsync();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <div className={styles.wrapper} data-testid="admin-panel">
      <div className={styles.label}>
        <span className={styles.tag}>admin</span>
        <span className={styles.hint}>moderation controls — visible to allowlisted wallets only</span>
      </div>
      <div className={styles.actions}>
        {error && <span className={styles.error}>{error}</span>}
        <Button
          variant="danger"
          size="sm"
          onClick={() => setConfirmOpen(true)}
          busy={hide.isPending}
          disabled={hide.isPending}
        >
          {hide.isPending ? "Hiding…" : "Hide token"}
        </Button>
      </div>

      {confirmOpen && (
        <Modal
          onClose={() => setConfirmOpen(false)}
          ariaLabelledBy="admin-confirm-hide-title"
          panelClassName={styles.confirmPanel}
        >
          <div className={styles.confirmContent}>
            <h2 id="admin-confirm-hide-title" className={styles.confirmTitle}>
              Hide token from listings?
            </h2>
            <p className={styles.confirmBody}>
              This removes{" "}
              <span className={styles.confirmTokenName}>
                {token.ticker} ({token.name})
              </span>{" "}
              from the home feed, search results, and direct-link page until
              an admin restores it. The on-chain token is untouched.
            </p>
            <div className={styles.confirmActions}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleConfirmHide}
                busy={hide.isPending}
                disabled={hide.isPending}
              >
                Hide token
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
