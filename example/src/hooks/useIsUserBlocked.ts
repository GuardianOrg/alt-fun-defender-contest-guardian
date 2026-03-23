import { useQuery } from "@tanstack/react-query";

const APP_ENV: string = (import.meta.env.VITE_APP_ENV as string) ?? "prod";

export const blockedCountries = [
  "US", // United States
  "GB", // United Kingdom
  "CA", // Canada (Because of Ontario)
  "RU", // Russia
  "LB", // Lebanon
  "SO", // Somalia
  "ZW", // Zimbabwe
  "BY", // Belarus
  "MM", // Burma (Myanmar)
  "CN", // China
  "CU", // Cuba
  "CD", // Democratic Republic of Congo
  "IR", // Iran
  "IQ", // Iraq
  "LR", // Liberia
  "KP", // North Korea
  "SD", // Sudan
  "SY", // Syria
  "VE", // Venezuela
  "YE", // Yemen
];

export const useIsUserBlocked = () => {
  const { data } = useQuery({
    queryKey: ["usersLocation"],
    queryFn: async () => {
      const res = await fetch("https://bounce.tech/cdn-cgi/trace", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Network error");
      const text = await res.text();

      const countryMatch = text.match(/loc=([A-Z]{2})/);
      const country = countryMatch ? countryMatch[1] : null;

      const isUserBlocked = Boolean(
        country && blockedCountries.includes(country) && APP_ENV === "prod",
      );

      return { isUserBlocked };
    },
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  return {
    isUserBlocked: data ? data.isUserBlocked : false,
  };
};
