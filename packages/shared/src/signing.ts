export interface TokenCreationPayload {
  address: string;
  name: string;
  ticker: string;
  description: string;
  imageUrl: string;
  ltPair: string;
  ltDirection: string;
  leverage: number;
  creator: string;
}

export function buildTokenCreationMessage(payload: TokenCreationPayload): string {
  return [
    "Create token metadata",
    `address:${payload.address}`,
    `name:${payload.name}`,
    `ticker:${payload.ticker}`,
    `description:${payload.description}`,
    `imageUrl:${payload.imageUrl}`,
    `ltPair:${payload.ltPair}`,
    `ltDirection:${payload.ltDirection}`,
    `leverage:${payload.leverage}`,
    `creator:${payload.creator}`,
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
