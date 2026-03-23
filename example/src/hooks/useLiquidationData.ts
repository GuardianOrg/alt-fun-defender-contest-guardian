import { useQuery } from "@tanstack/react-query";

import useBounceAccount from "../web3/views/useBounceAccount";
import useClaimed from "../web3/views/useClaimed";

import type { Address } from "viem";

const LIQUIDATIONS_ENDPOINT = "/data/liquidation-raw-data.json";

interface RawData {
  liquidations: number;
  points: number;
  rank?: number;
}

export interface LiquidationData {
  wallet: Address;
  liquidations: number;
  points: number;
  claimed: boolean;
  you: boolean;
  rank?: number;
}

const useLiquidationData = (): LiquidationData[] | null => {
  const claimed = useClaimed();
  const { address } = useBounceAccount();
  const { data: rawData } = useQuery<Record<string, RawData>>({
    queryKey: ["liquidation-raw-data"],
    queryFn: () => fetch(LIQUIDATIONS_ENDPOINT).then((res) => res.json()),
  });

  if (!claimed) return null;
  if (!rawData) return null;

  return Object.keys(rawData).map((user) => {
    const data = rawData[user];
    return {
      wallet: user as Address,
      liquidations: data.liquidations,
      points: data.points,
      claimed: claimed.includes(user as Address),
      you: address === user,
      rank: data.rank,
    };
  });
};

export default useLiquidationData;
