import { useQuery } from "@tanstack/react-query";

import { useWallet } from "./useWallet";
import { fetchAdminCheck } from "../services/api";

/**
 * Resolves whether the currently-connected wallet is in the moderation
 * admin allowlist (issue #586). Drives whether to render the admin
 * controls on the token detail page.
 *
 * Returns `false` (with `isPending: false`) when no wallet is
 * connected, so call sites can render "no admin UI" without separately
 * gating on connection state. The query is cached for 5 minutes — the
 * allowlist rotates via a redeploy / secret update, never per-request,
 * so refetching on every focus is wasteful.
 */
export function useIsAdmin(): { isAdmin: boolean; isPending: boolean } {
  const { address, isConnected } = useWallet();
  const enabled = isConnected && Boolean(address);

  const query = useQuery({
    queryKey: ["admin-check", address?.toLowerCase() ?? null],
    queryFn: () => {
      if (!address) throw new Error("Address required");
      return fetchAdminCheck(address);
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    // Allowlist failure should fail-closed (don't show admin UI to a
    // user when we can't confirm they're admin), so don't retry — a
    // transient 5xx blocking admin actions for ~30s is fine, mistakenly
    // showing admin UI is not.
    retry: false,
  });

  if (!enabled) return { isAdmin: false, isPending: false };
  return { isAdmin: query.data?.isAdmin ?? false, isPending: query.isPending };
}
