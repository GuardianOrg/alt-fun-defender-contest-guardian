/**
 * Wire types for the wallet-signed moderation API (issue #586).
 *
 * Single source of truth for `/api/v1/moderation/*` request and
 * response shapes — both the API route handlers and the web client
 * import these so the two can't drift. Mirrors the OpenAPI schemas
 * declared in `apps/api/src/openapi/spec.ts`.
 */

/** Response shape for `GET /api/v1/moderation/admins/:address`. */
export interface AdminCheckResponse {
  /** Checksummed copy of the requested address. */
  address: string;
  /** Whether the address sits in the moderation admin allowlist. */
  isAdmin: boolean;
}

/**
 * Body of `POST /api/v1/moderation/tokens/:address/{hide,unhide}`.
 *
 * Auth proof = a session signature (same shape as the profile-update
 * flow). Server recovers the signer via EIP-191, requires the
 * recovered address to match `address`, and checks that address
 * against the admin allowlist.
 */
export interface AdminSessionAuth {
  /** Admin wallet address (must match the recovered signer). */
  address: string;
  /** Hex-encoded EIP-191 signature of `buildSessionMessage(address, expiresAt)`. */
  signature: string;
  /** Unix-ms expiry baked into the signed message. */
  expiresAt: number;
}

/**
 * Response shape for the moderation hide / unhide endpoints. The
 * `admin` field echoes the recovered signer so the UI can confirm the
 * action was attributed to the expected wallet (useful when an admin
 * has multiple keys configured).
 */
export interface AdminTokenActionResponse {
  /** Token address whose `isHidden` flag was flipped. */
  address: string;
  /** Resulting `isHidden` state — `true` after `/hide`, `false` after `/unhide`. */
  isHidden: boolean;
  /** Recovered admin wallet that authorised the action. */
  admin: string;
}
