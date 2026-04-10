import { useEffect, useState } from "react";

import { isAddress } from "viem";

const REFERRAL_KEY = "launchpad_referrer";

export function useReferral(): string | undefined {
  const [referral, setReferral] = useState<string | undefined>(() => {
    const stored = sessionStorage.getItem(REFERRAL_KEY);
    return stored && isAddress(stored) ? stored : undefined;
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref && isAddress(ref)) {
      sessionStorage.setItem(REFERRAL_KEY, ref);
      setReferral(ref);
      return;
    }

    const stored = sessionStorage.getItem(REFERRAL_KEY);
    setReferral(stored && isAddress(stored) ? stored : undefined);
  }, []);

  return referral;
}
