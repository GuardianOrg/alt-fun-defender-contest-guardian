/** Session duration: 24 hours */
export const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Builds a session authentication message that the user signs once on login.
 * The signature is persisted in localStorage and reused for actions like
 * commenting and profile updates, avoiding repeated signing prompts.
 */
export function buildSessionMessage(address: string, expiresAt: number): string {
  return [
    "Sign in to Alt Fun",
    `address:${address}`,
    `expiresAt:${expiresAt}`,
  ].join("\n");
}

export function buildCommentMessage(
  tokenAddress: string,
  content: string,
  timestamp: number,
): string {
  return [
    "Post comment",
    `token:${tokenAddress}`,
    `content:${content}`,
    `timestamp:${timestamp}`,
  ].join("\n");
}

export interface ProfileUpdatePayload {
  address: string;
  displayName: string;
  bio: string;
  twitterUrl: string;
  timestamp: number;
}

export function buildProfileUpdateMessage(payload: ProfileUpdatePayload): string {
  return [
    "Update profile",
    `address:${payload.address}`,
    `displayName:${payload.displayName}`,
    `bio:${payload.bio}`,
    `twitterUrl:${payload.twitterUrl}`,
    `timestamp:${payload.timestamp}`,
  ].join("\n");
}
