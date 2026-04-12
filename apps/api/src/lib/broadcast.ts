import type { AppBindings } from "./types.js";

export async function broadcastToChannel(
  env: AppBindings,
  channel: string,
  data: unknown,
  tokenAddress?: string,
): Promise<void> {
  const id = env.WEBSOCKET_DO.idFromName("global");
  const stub = env.WEBSOCKET_DO.get(id);

  const url = new URL("https://internal/broadcast");
  const body = JSON.stringify({ channel, data, tokenAddress });

  await stub.fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}
