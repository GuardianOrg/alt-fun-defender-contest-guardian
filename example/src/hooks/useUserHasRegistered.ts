import { useQuery } from "@tanstack/react-query";

import { ADDRESS_HAS_REGISTERED_API } from "../app/api";
import useBounceAccount from "../web3/views/useBounceAccount";

export const useUserHasRegistered = () => {
  const { address } = useBounceAccount();

  const { data, refetch } = useQuery({
    queryKey: ["userHasRegistered", address],
    queryFn: async () => {
      if (!address) return false;

      const res = await fetch(
        `${ADDRESS_HAS_REGISTERED_API}?address=${address}`,
      );
      if (!res.ok) throw new Error("Network error");

      const json = await res.json();
      return Boolean(json.hasRegistered);
    },
  });

  return {
    hasRegistered: data ?? null,
    refetch,
  };
};
