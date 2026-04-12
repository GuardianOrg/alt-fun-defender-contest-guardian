const KEY_PREFIX_LENGTH = 8;

export async function hashApiKey(rawKey: string): Promise<string> {
  const encoded = new TextEncoder().encode(rawKey);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(digest));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function extractPrefix(rawKey: string): string {
  return rawKey.slice(0, KEY_PREFIX_LENGTH);
}

export async function verifyApiKey(rawKey: string, storedHash: string): Promise<boolean> {
  const candidateHash = await hashApiKey(rawKey);
  if (candidateHash.length !== storedHash.length) return false;

  // Constant-time comparison to prevent timing attacks
  let mismatch = 0;
  for (let i = 0; i < candidateHash.length; i++) {
    mismatch |= candidateHash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return mismatch === 0;
}
