import { toPng } from "html-to-image";

const PIXEL_RATIO = 3;

export const handleCopyImage = async (
  statsRef: React.RefObject<HTMLDivElement | null>,
  setCopied: (copied: boolean) => void,
) => {
  if (!statsRef.current) return;

  try {
    const dataUrl = await toPng(statsRef.current, {
      cacheBust: true,
      pixelRatio: PIXEL_RATIO,
    });

    const res = await fetch(dataUrl);
    const blob = await res.blob();

    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": blob,
      }),
    ]);

    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  } catch (err) {
    console.error("Error copying image to clipboard:", err);
  }
};
