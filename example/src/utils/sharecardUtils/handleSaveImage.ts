import { toCanvas } from "html-to-image";

import { isIOSWallet } from "./getWalletType";

const PIXEL_RATIO = 3;

export const handleSaveImage = async (
  statsRef: React.RefObject<HTMLDivElement | null>,
) => {
  if (!statsRef.current) return;

  try {
    const canvas = await toCanvas(statsRef.current, {
      pixelRatio: PIXEL_RATIO,
    });

    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], "bounce-pnl-share.png", {
        type: "image/png",
      });

      if (isIOSWallet() && navigator.canShare?.({ files: [file] })) {
        navigator.share({ files: [file], title: "PnL" });
      } else {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(file);
        link.download = "bounce-pnl-share.png";
        link.click();
      }
    });
  } catch (err) {
    console.error("Error saving image:", err);
  }
};
