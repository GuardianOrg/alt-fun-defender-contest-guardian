import { toCanvas } from "html-to-image";

import { isIOSWallet } from "./getWalletType";

const PIXEL_RATIO = 3;

const CAPTURE_OPTIONS = {
  pixelRatio: PIXEL_RATIO,
  cacheBust: true,
} as const;

export const handleSaveImage = async (
  statsRef: React.RefObject<HTMLDivElement | null>,
  fileName?: string,
) => {
  if (!statsRef.current) return;

  try {
    const node = statsRef.current;

    if (isIOSWallet()) {
      await toCanvas(node, CAPTURE_OPTIONS);
      await new Promise((r) => setTimeout(r, 200));
    }

    const canvas = await toCanvas(node, CAPTURE_OPTIONS);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], fileName || "bounce-pnl-share.png", {
        type: "image/png",
      });

      if (isIOSWallet() && navigator.canShare?.({ files: [file] })) {
        navigator.share({ files: [file], title: "PnL" });
      } else {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(file);
        link.download = fileName || "bounce-pnl-share.png";
        link.click();
      }
    });
  } catch (err) {
    console.error("Error saving image:", err);
  }
};
