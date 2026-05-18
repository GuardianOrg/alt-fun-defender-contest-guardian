import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useSessionSignature } from "./useSessionSignature";
import { useWallet } from "./useWallet";
import { hideTokenApi, unhideTokenApi } from "../services/api";

/**
 * Hide / unhide a token via the wallet-signed moderation endpoint
 * (issue #586). Reuses `useSessionSignature` so the admin signs at
 * most once per 24-hour window — subsequent moderation actions
 * within the window go through silently.
 *
 * Cache invalidation: after a successful action we invalidate the
 * `token` (single-token detail) and `tokens-infinite` (catalogue —
 * shared between `useTokens` and `useInfiniteTokens`, see
 * `useTokens.ts` JSDoc) query namespaces so the home-page list and
 * detail page reflect the new state without a manual refresh. For
 * non-holders the detail-page query will surface as "not found" 404
 * after a hide — that's the public lens (see `/tokens/:address` route).
 * Connected holders of the just-hidden token still load the page via
 * the wallet-gated bypass (issue #712); the page re-renders with the
 * policy-violation banner + sell-only trade panel.
 */
export function useTokenModeration(tokenAddress: string | undefined) {
  const { address, isConnected } = useWallet();
  const { getSessionSignature } = useSessionSignature();
  const queryClient = useQueryClient();

  function invalidateAfterMutation() {
    queryClient.invalidateQueries({ queryKey: ["token", tokenAddress] });
    queryClient.invalidateQueries({ queryKey: ["tokens-infinite"] });
  }

  async function buildAuth() {
    if (!isConnected || !address) {
      throw new Error("Connect wallet first");
    }
    const session = await getSessionSignature();
    return {
      address,
      signature: session.signature,
      expiresAt: session.expiresAt,
    };
  }

  const hide = useMutation({
    mutationFn: async () => {
      if (!tokenAddress) throw new Error("Token address required");
      const auth = await buildAuth();
      return hideTokenApi(tokenAddress, auth);
    },
    onSuccess: invalidateAfterMutation,
  });

  const unhide = useMutation({
    mutationFn: async () => {
      if (!tokenAddress) throw new Error("Token address required");
      const auth = await buildAuth();
      return unhideTokenApi(tokenAddress, auth);
    },
    onSuccess: invalidateAfterMutation,
  });

  return { hide, unhide };
}
