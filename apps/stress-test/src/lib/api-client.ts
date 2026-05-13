import type { RandomImage } from "./images.ts";

/**
 * Minimal typed wrapper around the Alt Fun API surfaces this harness
 * actually hits — `POST /api/v1/images` (image moderation + R2 write)
 * and `POST /api/v1/tokens` (address-only token registration). The web
 * app's `src/services/api.ts` is the canonical reference; we duplicate
 * the shape locally instead of pulling it in because that module reads
 * `import.meta.env` for the API base URL, which doesn't exist in Node.
 *
 * Auth: `apps/api`'s middleware (`apiKeyAuth`) bypasses the rate limit
 * for localhost callers (Host header check) and requires `X-API-Key`
 * everywhere else. We forward the env-provided key when present so the
 * same harness binary works against both local and deployed APIs without
 * recompilation.
 */
export interface AltFunApiClient {
  uploadImage(image: RandomImage): Promise<{ url: string }>;
  registerToken(address: `0x${string}`): Promise<void>;
}

interface ApiResponse<T> {
  status: "success" | "error";
  data: T | null;
  error: string | null;
}

/**
 * Per-request timeout. Image upload involves OpenAI moderation +
 * R2 write, both of which can stretch under load; 30s covers the
 * realistic upper tail without letting a stalled upstream wedge an
 * iteration indefinitely. AbortSignal-aborted fetches throw, and the
 * iteration's top-level catch turns the throw into a per-iteration
 * failure entry that won't block the rest of the sweep.
 */
const API_FETCH_TIMEOUT_MS = 30_000;

export function buildApiClient(
  baseUrl: string,
  apiKey: string | null,
): AltFunApiClient {
  const headers: Record<string, string> = {};
  if (apiKey) headers["X-API-Key"] = apiKey;

  async function postForm<T>(path: string, form: FormData): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: form,
      signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS),
    });
    const body = (await res.json()) as ApiResponse<T>;
    if (!res.ok || body.status === "error" || body.data === null) {
      throw new Error(
        `${path} → ${res.status}: ${body.error ?? "no error body"}`,
      );
    }
    return body.data;
  }

  async function postJson<T>(path: string, json: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(json),
      signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS),
    });
    const body = (await res.json()) as ApiResponse<T>;
    if (!res.ok || body.status === "error" || body.data === null) {
      throw new Error(
        `${path} → ${res.status}: ${body.error ?? "no error body"}`,
      );
    }
    return body.data;
  }

  return {
    async uploadImage(image) {
      const form = new FormData();
      // Wrap the raw bytes in a `Blob` rather than reaching for Node's
      // `File` — Node 22's `FormData.append` accepts a Blob with a name
      // override as its third argument, which preserves the filename
      // through to multipart parsing on the Worker without forcing us
      // to instantiate a polyfilled `File` class.
      const blob = new Blob([image.bytes], { type: image.contentType });
      form.append("file", blob, image.filename);
      return postForm<{ url: string }>("/api/v1/images", form);
    },
    async registerToken(address) {
      await postJson<unknown>("/api/v1/tokens", { address });
    },
  };
}
