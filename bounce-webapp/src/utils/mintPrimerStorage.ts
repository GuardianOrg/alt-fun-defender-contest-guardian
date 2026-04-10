const MINT_PRIMER_VIEWED_KEY = "bounce_mint_primer_viewed";

export function hasViewedMintPrimer(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(MINT_PRIMER_VIEWED_KEY) === "true";
  } catch {
    return false;
  }
}

/** Whether the mint primer should start open (first visit / not yet dismissed). */
export function getInitialMintPrimerModalOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !hasViewedMintPrimer();
  } catch {
    return false;
  }
}

export function markMintPrimerViewed(): void {
  try {
    localStorage.setItem(MINT_PRIMER_VIEWED_KEY, "true");
  } catch {
    // ignore quota / private mode
  }
}
