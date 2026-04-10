import { useEffect } from "react";

import { useDispatch, useSelector } from "react-redux";
import { recoverMessageAddress } from "viem";
import { useSignMessage as useSignMessageWagmi } from "wagmi";

import { SIGNATURE_MESSAGE } from "../app/constants";
import { selectSignature, setSignature } from "../state/registerSlice";
import useBounceAccount from "../web3/views/useBounceAccount";

const useSignMessage = (): (() => void) => {
  const dispatch = useDispatch();
  const signature = useSelector(selectSignature);
  const { address } = useBounceAccount();
  const { data, signMessage: signMessageWagmi } = useSignMessageWagmi();

  // Validate signature, write to storage, and update state
  useEffect(() => {
    if (!data) return;
    const validateAndWriteToStorage = async () => {
      const recoveredAddress = await recoverMessageAddress({
        message: SIGNATURE_MESSAGE,
        signature: data,
      });
      localStorage.setItem(`bounce-signature-${recoveredAddress}`, data);
      dispatch(setSignature(data));
    };
    validateAndWriteToStorage();
  }, [data, dispatch]);

  // Function to sign the message
  const signMessage = () => {
    if (!address || !!signature) return;
    signMessageWagmi({ message: SIGNATURE_MESSAGE });
  };

  // Return the function to sign the message
  return signMessage;
};

export default useSignMessage;
