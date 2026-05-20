import { useSyncExternalStore } from "react";

import { getWebSocketClient } from "../services/websocket";

function getSnapshot(): boolean {
  return getWebSocketClient()?.hasConnectionIssue ?? false;
}

export function useWebSocketReconnecting(): boolean {
  return useSyncExternalStore(
    (listener) => getWebSocketClient()?.subscribeStatus(listener) ?? (() => {}),
    getSnapshot,
    () => false,
  );
}
