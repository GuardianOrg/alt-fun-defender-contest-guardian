import { useEffect } from "react";

import { useDispatch } from "react-redux";
import { recoverMessageAddress, type Address } from "viem";

import { SIGNATURE_MESSAGE } from "../app/constants";
import { setSignature } from "../state/registerSlice";
import useBounceAccount from "../web3/views/useBounceAccount";

const SignatureHandler = () => {
  const dispatch = useDispatch();
  const { address } = useBounceAccount();

  // Querying the signature from storage, updating state if it's valid
  useEffect(() => {
    if (!address) {
      dispatch(setSignature(null));
      return;
    }

    const signature_ = localStorage.getItem(`bounce-signature-${address}`);
    if (!signature_) {
      dispatch(setSignature(null));
      return;
    }

    const validateAndSetSignature = async () => {
      const recoveredAddress = await recoverMessageAddress({
        message: SIGNATURE_MESSAGE,
        signature: signature_ as Address,
      });
      if (recoveredAddress !== address) return;
      dispatch(setSignature(signature_));
    };
    validateAndSetSignature();
  }, [address, dispatch]);

  return null;
};

export default SignatureHandler;
