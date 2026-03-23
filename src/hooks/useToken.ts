import { useQuery } from "@tanstack/react-query";

import { tokenService } from "../services/tokenService";

export function useToken(address: string | undefined) {
  return useQuery({
    queryKey: ["token", address],
    queryFn: () => {
      if (!address) throw new Error("Address required");
      return tokenService.getToken(address);
    },
    enabled: !!address,
  });
}
