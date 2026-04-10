import { useEffect, useMemo } from "react";

import { isAddress } from "viem";

const REFERRAL_KEY = "launchpad_referrer";

export function useReferral(): string | undefined {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref && isAddress(ref)) {
      sessionStorage.setItem(REFERRAL_KEY, ref);
    }
  }, []);

  return useMemo(() => {
    const stored = sessionStorage.getItem(REFERRAL_KEY);
    return stored && isAddress(stored) ? stored : undefined;
  }, []);
}
