import { useQuery } from "@tanstack/react-query";
import { zeroAddress, type Address } from "viem";

import { INDEX_API } from "../../app/api";
import { REFRESH_INTERVAL } from "../../app/constants";
import useBounceAccount from "../../web3/views/useBounceAccount";

export interface ReferralsData {
  referralCode: string | null;
  referrerCode: string | null;
  referrerAddress: Address;
  isJoined: boolean;
  referredUserCount: number;
  referrerRebates: number;
  refereeRebates: number;
  totalRebates: number;
  claimedRebates: number;
  claimableRebates: number;
}

export const useReferrals = () => {
  const { address: usersAddress } = useBounceAccount();

  return useQuery({
    queryKey: ["referrals", usersAddress],
    enabled: !!usersAddress,
    refetchInterval: REFRESH_INTERVAL,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async (): Promise<ReferralsData> => {
      const res = await fetch(`${INDEX_API}user-referrals/${usersAddress}`);
      const data = await res.json();
      if (data.status !== "success") {
        throw new Error(`Failed to fetch user referrals: ${data.error}`);
      }
      return data.data;
    },
    placeholderData: (previousData) => previousData,
  });
};

export const useReferralsData = (): ReferralsData => {
  const { data } = useReferrals();
  return (
    data ?? {
      referralCode: null,
      referrerCode: null,
      referrerAddress: zeroAddress,
      isJoined: true,
      referredUserCount: 0,
      referrerRebates: 0,
      refereeRebates: 0,
      totalRebates: 0,
      claimedRebates: 0,
      claimableRebates: 0,
    }
  );
};
