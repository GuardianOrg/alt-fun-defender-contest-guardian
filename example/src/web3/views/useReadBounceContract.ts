import { useEffect, useRef } from "react";

import { useDispatch } from "react-redux";
import { useReadContract } from "wagmi";

import { REFRESH_INTERVAL } from "../../app/constants";
import { hyperEvm } from "../../app/wagmi";
import { setError } from "../../state/errorSlice";

import type { Abi, Address } from "viem";

const useReadBounceContract = (
  enabled: boolean,
  livePolling: boolean,
  address: Address,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  abi: any,
  functionName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args?: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any | null => {
  const dispatch = useDispatch();

  const errorCount = useRef(0);

  const { data, isLoading, isError, error } = useReadContract({
    address: address,
    abi: abi as Abi,
    functionName: functionName,
    args: args,
    chainId: hyperEvm.id,
    query: {
      enabled: enabled,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchInterval: livePolling ? REFRESH_INTERVAL : false,
    },
  });

  // Surface errors
  useEffect(() => {
    if (!error) return;
    errorCount.current += 1;
    console.error(`Error reading ${functionName} from ${address}:`, error);
    if (errorCount.current === 3) {
      dispatch(
        setError({
          message:
            "We are experiencing RPC issues. If this continues, please reach out to support on Discord.",
          details: error.message,
        }),
      );
    }
  }, [error, dispatch, functionName, address]);

  useEffect(() => {
    if (data && !error) {
      if (errorCount.current > 0) {
        errorCount.current = 0;
      }
    }
  }, [data, error]);

  if (!enabled) return null;
  if (isError) return null;
  if (isLoading) return null;

  return data;
};

export default useReadBounceContract;
