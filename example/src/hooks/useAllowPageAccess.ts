import { useAccount } from "wagmi";

import { useUserHasRegistered } from "./useUserHasRegistered";
import useHasClaimed from "../web3/views/useHasClaimed";

export const useAllowPageAccess = () => {
  const { address } = useAccount();
  const hasClaimed = useHasClaimed(address);
  const { hasRegistered } = useUserHasRegistered();

  return hasClaimed || hasRegistered;
};
