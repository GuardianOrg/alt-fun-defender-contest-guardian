const LOCAL_STORAGE_KEY = "hasOpenedLiquidationsJourney";

const normalize = (addr: string) => addr.toLowerCase();

export const getOpenedAddresses = (): string[] => {
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);

    if (!stored) return [];

    const parsed = JSON.parse(stored);

    // ✅ Ensure it's actually an array and that each item is a string (address)
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
    ) {
      return parsed;
    }

    // ❗ Handle legacy values ("true", etc.)
    return [];
  } catch {
    return [];
  }
};

export const hasAddressOpened = (address: string | null): boolean => {
  if (!address) return false;

  const normalized = normalize(address);
  const addresses = getOpenedAddresses();

  return addresses.includes(normalized);
};

export const addOpenedAddress = (address: string | null) => {
  if (!address) return;

  const normalized = normalize(address);
  const existing = getOpenedAddresses();

  if (!existing.includes(normalized)) {
    const updated = [...existing, normalized];
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
  }
};
