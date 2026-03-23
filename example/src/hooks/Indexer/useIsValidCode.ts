import { useQuery } from "@tanstack/react-query";

import { INDEX_API } from "../../app/api";

const useIsValidCode = (code: string) => {
  const { data } = useQuery({
    queryKey: ["isValidCode", code],
    enabled: !!code,
    queryFn: async () => {
      const res = await fetch(`${INDEX_API}is-valid-code/${code}`);
      const json = await res.json();
      if (json.status !== "success") {
        throw new Error(`Failed to fetch user Bounce stats: ${json.error}`);
      }
      return json.data;
    },
  });

  return {
    isValid: data ?? false,
  };
};

export default useIsValidCode;
