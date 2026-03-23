import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { INDEX_API } from "../../app/api";

export interface GlobalStorageData {
  minTransactionSize: bigint;
  redemptionFee: bigint;
  refereeRebate: bigint;
  referrerRebate: bigint;
  allMintsPaused: boolean;
}

const defaultGlobalStorage: GlobalStorageData = {
  minTransactionSize: 0n,
  redemptionFee: 0n,
  refereeRebate: 0n,
  referrerRebate: 0n,
  allMintsPaused: false,
};

export const useGlobalStorage = (): UseQueryResult<
  GlobalStorageData,
  Error
> => {
  return useQuery<GlobalStorageData, Error>({
    queryKey: ["globalStorage"],
    queryFn: async (): Promise<GlobalStorageData> => {
      const res = await fetch(`${INDEX_API}global-storage`);
      const json = await res.json();

      if (json.status !== "success") throw new Error(json.error);

      return {
        minTransactionSize: BigInt(json.data.minTransactionSize),
        redemptionFee: BigInt(json.data.redemptionFee),
        refereeRebate: BigInt(json.data.refereeRebate),
        referrerRebate: BigInt(json.data.referrerRebate),
        allMintsPaused: json.data.allMintsPaused,
      };
    },
    initialData: defaultGlobalStorage,
  });
};

export const useGlobalStorageData = (): GlobalStorageData => {
  const { data } = useGlobalStorage();
  return data ?? defaultGlobalStorage;
};
