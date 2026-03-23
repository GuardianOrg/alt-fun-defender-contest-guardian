import { useState, useCallback, useRef } from "react";

import { copyToClipboard } from "../utils/format";

export function useCopyState(timeout = 2000) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const copy = useCallback(
    (text: string) => {
      copyToClipboard(text);
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), timeout);
    },
    [timeout],
  );

  return { copied, copy };
}
