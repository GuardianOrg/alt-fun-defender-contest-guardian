import { useEffect } from "react";

import useIsValidCode from "../hooks/Indexer/useIsValidCode";

const ReferralHandler = () => {
  const params = new URLSearchParams(window.location.search);
  const refCode = params.get("ref");

  const { isValid } = useIsValidCode(refCode || "");

  useEffect(() => {
    if (isValid && refCode) {
      localStorage.setItem("referral_code", refCode);
    }
  }, [isValid, refCode]);
  return null;
};
export default ReferralHandler;
