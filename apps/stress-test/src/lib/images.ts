import { randomBytes } from "node:crypto";

/**
 * Random-image source.
 *
 * We hit `picsum.photos/seed/<seed>/<w>/<h>.jpg` because:
 *
 *   - Free, no auth, no rate limit relevant to a 1K-token sweep.
 *   - Deterministic per-seed (the seed selects an image from their
 *     curated set), so a re-run with the same seed produces the same
 *     bytes — useful when reproducing a moderation incident.
 *   - Different seeds produce *different* images. The image-upload
 *     pipeline is the explicit reason this scenario is in the harness;
 *     a hard-coded test image would short-circuit any future dedup /
 *     perceptual-hash logic on the moderation path and silently stop
 *     exercising it.
 *
 * 200×200 is comfortably below the 5MB upload cap (`MAX_IMAGE_BYTES`)
 * and matches the token-logo aspect the UI actually renders.
 */
const PICSUM_BASE = "https://picsum.photos";
const IMAGE_DIMENSION = 200;

export interface RandomImage {
  filename: string;
  contentType: "image/jpeg";
  bytes: Uint8Array;
}

/**
 * Per-fetch timeout — picsum's CDN is normally <500ms; anything past
 * 10s is a network or CDN stall we'd rather fail fast on than wedge an
 * iteration behind. AbortSignal abort surfaces as a rejected fetch
 * with a useful `TimeoutError`-shaped Error, which the iteration's
 * top-level catch already turns into a per-iteration failure entry.
 */
const IMAGE_FETCH_TIMEOUT_MS = 10_000;

export async function fetchRandomImage(): Promise<RandomImage> {
  const seed = randomBytes(8).toString("hex");
  const url = `${PICSUM_BASE}/seed/${seed}/${IMAGE_DIMENSION}/${IMAGE_DIMENSION}.jpg`;

  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `picsum.photos fetch failed: ${response.status} ${response.statusText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    throw new Error("picsum.photos returned an empty image");
  }

  return {
    filename: `stress-${seed}.jpg`,
    contentType: "image/jpeg",
    bytes: new Uint8Array(arrayBuffer),
  };
}
