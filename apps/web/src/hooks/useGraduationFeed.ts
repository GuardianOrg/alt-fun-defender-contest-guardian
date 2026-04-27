import { useEffect } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { getWebSocketClient } from "../services/websocket";

/**
 * Subscribe to the `graduation` WebSocket channel for a single token. The
 * indexer broadcasts on this channel from both `Bonding.TokenGraduating`
 * (phase 1, fires inline on the threshold-crossing buy) and
 * `Bonding.TokenGraduated` (phase 2, fires when the keeper calls
 * `finalizeGraduation`). Either event is interesting: phase 1 flips the UI
 * into the "Token is graduating" overlay, phase 2 transitions to the
 * post-grad UI.
 *
 * Strategy is "invalidate, don't merge": each event is a coarse-grained
 * lifecycle change, so we just invalidate the token query and let the API
 * round-trip resolve the new state. Avoids replicating the API's enrichment
 * logic on the client and ensures we pick up `hyperswapPair` /
 * `pendingGraduationAt` etc. consistently.
 *
 * If `VITE_WS_URL` isn't set (local dev without the API Worker), this is a
 * no-op — the user just won't get the live transition. The 10s `staleTime`
 * default in `App.tsx` means polling on next interaction will catch up.
 */
export function useGraduationFeed(address: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!address) return;
    const ws = getWebSocketClient();
    if (!ws) return;

    const normalized = address.toLowerCase();
    const unsub = ws.subscribe(
      "graduation",
      () => {
        // The webhook payload includes the phase (`"graduating"` /
        // `"graduated"`) but we don't need to inspect it — every event
        // means the token row's lifecycle moved, so always re-fetch.
        queryClient.invalidateQueries({ queryKey: ["token", address] });
        queryClient.invalidateQueries({ queryKey: ["tokens"] });
      },
      normalized,
    );

    return unsub;
  }, [address, queryClient]);
}
