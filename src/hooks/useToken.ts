import { useQuery } from "@tanstack/react-query";

import { tokenService } from "../services/tokenService";

export function useToken(address: string | undefined) {
  return useQuery({
    queryKey: ["token", address],
    queryFn: () => tokenService.getToken(address!),
    enabled: !!address,
  });
}
