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
