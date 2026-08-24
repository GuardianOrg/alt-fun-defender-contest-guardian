/**
 * OpenAI `omni-moderation-latest` image moderation.
 *
 * The endpoint is free (`https://platform.openai.com/docs/guides/moderation`,
 * cross-checked against `https://help.openai.com/en/articles/4936833`) and
 * supports multimodal inputs up to 20MB per image. The image-applicable
 * categories are: `sexual`, `self-harm`, `self-harm/intent`,
 * `self-harm/instructions`, `violence`, `violence/graphic`. The remaining
 * categories (`harassment*`, `hate*`, `illicit*`, `sexual/minors`) are
 * text-only and always score 0 on a pure-image input.
 *
 * **CSAM caveat (read before changing thresholds):** OpenAI does not return
 * `sexual/minors` from images — that category is text-only by design. CSAM
 * imagery still scores high on `sexual`, so a conservative `sexual`
 * threshold acts as a coarse proxy here, but this layer is explicitly NOT
 * a substitute for a NCMEC-certified hash matcher (Microsoft PhotoDNA or
 * equivalent). Tracked separately — see `AGENTS.md` → "Image Upload &
 * Content Moderation".
 *
 * If the API key is missing or the request fails, we fail **closed** —
 * `unavailable: true` → 503 → no upload. Letting unmoderated content into
 * R2 is the failure mode we're trying to avoid; a temporary 503 is the
 * lesser harm. A PNG encoded in a way OpenAI provably can't decode also
 * fails closed, but as `unprocessable: true` → 400, so the uploader is
 * asked for a different file instead of retrying bytes that can never
 * pass — see `isUndecodablePng`.
 */

const OPENAI_MODERATION_URL = "https://api.openai.com/v1/moderations";
const MODERATION_MODEL = "omni-moderation-latest";

/**
 * Per-request abort window for the OpenAI moderation call. Sized to
 * absorb the long tail of legitimate slow responses (cold Worker
 * isolate → cold TCP/TLS to api.openai.com + OpenAI's own occasional
 * multi-second multimodal latency) without the fail-closed path
 * stamping a 503 on the user.
 *
 * Empirically, warm-isolate calls land in <1s and slow-but-healthy
 * cold-isolate calls land in 2–5s. The previous 10s cap was tight
 * enough that one cold isolate per region per ~30s tripped the abort,
 * which then engaged the cooldown (`COOLDOWN_MS` below) and 503'd the
 * user for a full additional 30s on that isolate — a single OpenAI
 * tail event surfaced as "Image moderation is temporarily unavailable"
 * in the launch flow. 25s gives OpenAI ~5–10× headroom over the
 * observed slow-path while staying well inside Cloudflare Workers'
 * subrequest budget, so the abort now only fires on actually-stuck
 * requests rather than slow-but-progressing ones.
 *
 * Why not even higher: token creation has the user staring at a
 * spinner before the wallet popup. Beyond ~25s the perceived UX is
 * "frozen", and at that point a fail-fast → user retry is a better
 * outcome than continuing to wait. 25s is the sweet spot between
 * "swallows OpenAI's natural tail" and "doesn't make the launch flow
 * feel hung".
 */
const REQUEST_TIMEOUT_MS = 25_000;

/**
 * When OpenAI returns 429 / 5xx we enter a process-local cooldown for
 * this long. While the cooldown is active, subsequent calls short-circuit
 * to `unavailable: true` without re-hitting OpenAI.
 *
 * Two reasons (issue #509):
 *   1. Don't compound the upstream rate limit during abuse bursts. Once
 *      OpenAI has signalled they're throttling us, hammering them with
 *      more requests is the worst possible reaction — it extends the
 *      penalty window and risks tripping a stricter automated block on
 *      our account.
 *   2. Legitimate users during the burst window get the same
 *      "try again in a moment" 503 the throttled callers would have
 *      gotten anyway, but without us spending a request to confirm it.
 *
 * Per-isolate, not shared across isolates/regions. That's fine for a
 * defensive cooldown: even partial coverage materially reduces request
 * volume to OpenAI during incidents, and a stale cooldown just costs us
 * one extra 503 on the next isolate that hasn't tripped yet.
 */
const COOLDOWN_MS = 30_000;
let cooldownUntil = 0;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * IHDR is mandatory as PNG's first chunk, so bit depth and colour type
 * sit at fixed offsets: 8-byte signature + 4-byte length + 4-byte type.
 */
const IHDR_BIT_DEPTH_OFFSET = 24;
const IHDR_COLOUR_TYPE_OFFSET = 25;

const PNG_COLOUR_TYPE_GRAYSCALE = 0;
const PNG_COLOUR_TYPE_GRAYSCALE_ALPHA = 4;

interface PngIhdr {
  bitDepth: number;
  colourType: number;
}

/**
 * Signature-gated, so a non-PNG payload — or one too short to carry an
 * IHDR — reads as `null` and is left to OpenAI to judge.
 */
function readPngIhdr(bytes: Uint8Array): PngIhdr | null {
  if (bytes.length <= IHDR_COLOUR_TYPE_OFFSET) return null;
  if (PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte)) return null;
  return {
    bitDepth: bytes[IHDR_BIT_DEPTH_OFFSET],
    colourType: bytes[IHDR_COLOUR_TYPE_OFFSET],
  };
}

/**
 * Whether OpenAI's moderation endpoint will fail to decode this PNG.
 *
 * Exactly two encodings reproduce a `500 {"type":"server_error"}` on
 * every attempt: 8-bit grayscale-plus-alpha, and 16-bit grayscale. Both
 * are ordinary Pillow / ImageMagick output for a monochrome logo with
 * transparency, so this is a shape real token logos arrive in, not a
 * hypothetical.
 *
 * We check before spending the request because OpenAI reports "I can't
 * read this file" with the same status it uses for its own outages, and
 * that conflation costs us twice: the uploader is told to retry bytes
 * that can never pass, and the 5xx arms `COOLDOWN_MS`, so one
 * undecodable logo 503s every *other* caller on this isolate for the
 * next 30 seconds. Catching it locally keeps the 5xx branch below
 * meaning strictly "OpenAI is unhealthy".
 *
 * Both combinations are verified against the live endpoint, and so are
 * their immediate neighbours — grayscale-plus-alpha at bit depth *16*
 * decodes fine, as does grayscale at 1/2/4/8. Hence the exact pairs
 * rather than a colour-type match: widening this silently rejects valid
 * logos, which is worse than the 503 it saves.
 */
function isUndecodablePng({ bitDepth, colourType }: PngIhdr): boolean {
  if (colourType === PNG_COLOUR_TYPE_GRAYSCALE_ALPHA) return bitDepth === 8;
  return colourType === PNG_COLOUR_TYPE_GRAYSCALE && bitDepth === 16;
}

/** Exposed for tests so each case starts with a clean slate. */
export function __resetModerationCooldownForTests(): void {
  cooldownUntil = 0;
}

export interface CategoryScore {
  label: string;
  score: number;
}

export interface ModerationResult {
  safe: boolean;
  flaggedForReview: boolean;
  reason: string;
  unavailable?: boolean;
  /**
   * The moderator is reachable but can't read this particular file. A
   * retry of the same bytes is guaranteed to fail, so the caller must
   * ask for a different image rather than offering "try again".
   */
  unprocessable?: boolean;
  classifications: CategoryScore[];
}

/**
 * Per-category thresholds for image-supported categories.
 *
 * `reject` is the auto-reject score; `review` flags borderline content
 * for human review without rejecting it. Rationale per category:
 *
 * - `sexual`: stricter `reject` because this is the catch-all for adult
 *   imagery AND the coarse CSAM proxy (see file-level note above).
 *   Adult content is permitted by policy when legal, but anything OpenAI
 *   scores ≥0.7 is well past the "tasteful nudity" line into explicit
 *   territory we don't want as a token logo.
 * - `violence/graphic`: gore. Strict.
 * - `violence`: depictions of violence — looser ceiling so action-movie
 *   stills don't auto-reject, but anything ≥0.85 is unambiguously gory.
 * - `self-harm*`: strict — these have real-world harm implications.
 *
 * These thresholds intentionally reject *more* than OpenAI's own
 * `flagged: true` boolean, because OpenAI calibrates `flagged` for chat
 * UX (false positives are costly) whereas a token logo is a publication
 * surface where false negatives are costly. We trip on score *and* on
 * `flagged: true` for any image-applicable category.
 */
const CATEGORY_THRESHOLDS: Record<string, { reject: number; review: number }> = {
  sexual: { reject: 0.7, review: 0.4 },
  "violence/graphic": { reject: 0.7, review: 0.4 },
  violence: { reject: 0.85, review: 0.5 },
  "self-harm": { reject: 0.7, review: 0.4 },
  "self-harm/intent": { reject: 0.7, review: 0.4 },
  "self-harm/instructions": { reject: 0.7, review: 0.4 },
};

interface OpenAIModerationResult {
  flagged: boolean;
  categories: Record<string, boolean>;
  category_scores: Record<string, number>;
  category_applied_input_types?: Record<string, string[]>;
}

interface OpenAIModerationResponse {
  id: string;
  model: string;
  results: OpenAIModerationResult[];
}

function bytesToBase64(bytes: Uint8Array): string {
  // Workers / modern V8 expose `btoa`. Process in 8KB chunks to avoid
  // blowing the call-stack on large payloads (`String.fromCharCode(...)`
  // spreads each byte as a separate argument).
  const chunkSize = 0x2000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function buildClassifications(
  scores: Record<string, number>,
  appliedInputs: Record<string, string[]> | undefined,
): CategoryScore[] {
  const out: CategoryScore[] = [];
  for (const [label, score] of Object.entries(scores)) {
    if (typeof score !== "number") continue;
    // Drop categories OpenAI didn't actually evaluate against the image
    // (text-only categories return 0 on image-only input — keeping them
    // in the audit log just adds noise).
    const applied = appliedInputs?.[label];
    if (applied && !applied.includes("image")) continue;
    out.push({ label, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

interface DecisionContext {
  categories: Record<string, boolean>;
  scores: Record<string, number>;
  appliedInputs: Record<string, string[]> | undefined;
  flaggedByOpenAI: boolean;
}

function decide(ctx: DecisionContext): { safe: boolean; flaggedForReview: boolean; reason: string } {
  let highestRejectCategory: { label: string; score: number } | null = null;
  let highestReviewCategory: { label: string; score: number } | null = null;

  for (const [label, threshold] of Object.entries(CATEGORY_THRESHOLDS)) {
    const score = ctx.scores[label];
    if (typeof score !== "number") continue;

    const applied = ctx.appliedInputs?.[label];
    if (applied && !applied.includes("image")) continue;

    if (score >= threshold.reject) {
      if (!highestRejectCategory || score > highestRejectCategory.score) {
        highestRejectCategory = { label, score };
      }
      continue;
    }

    if (ctx.categories[label] === true) {
      // OpenAI itself flagged this category. Treat as auto-reject even
      // if our score threshold wasn't tripped — the model has policy
      // calibration we don't.
      if (!highestRejectCategory || score > highestRejectCategory.score) {
        highestRejectCategory = { label, score };
      }
      continue;
    }

    if (score >= threshold.review) {
      if (!highestReviewCategory || score > highestReviewCategory.score) {
        highestReviewCategory = { label, score };
      }
    }
  }

  if (highestRejectCategory) {
    return {
      safe: false,
      flaggedForReview: false,
      reason: "Image contains content that violates our policy",
    };
  }

  if (highestReviewCategory) {
    return {
      safe: false,
      flaggedForReview: true,
      reason: "Image flagged for manual review",
    };
  }

  if (ctx.flaggedByOpenAI) {
    // Fail-safe: if OpenAI flags content outside our explicit thresholds
    // (e.g. a category they add in the future, or a text-only category
    // that somehow tripped on an image), reject rather than risk letting
    // it through the review queue. Consistent with the publication-surface
    // strictness documented in `AGENTS.md` → *Image Upload & Content
    // Moderation*. If it turns out to be too strict for a specific new
    // category, add a threshold to `CATEGORY_THRESHOLDS` to handle it
    // explicitly.
    return {
      safe: false,
      flaggedForReview: false,
      reason: "Image contains content that violates our policy",
    };
  }

  return { safe: true, flaggedForReview: false, reason: "" };
}

export async function moderateImage(
  apiKey: string | undefined,
  imageBytes: Uint8Array,
  mimeType: string,
): Promise<ModerationResult> {
  if (!apiKey) {
    return {
      safe: false,
      flaggedForReview: false,
      reason: "Image moderation is temporarily unavailable. Please try again.",
      unavailable: true,
      classifications: [],
    };
  }

  // Ahead of the cooldown check on purpose: the verdict is a property of
  // the bytes, so it holds whether or not OpenAI is currently reachable.
  const ihdr = readPngIhdr(imageBytes);
  if (ihdr && isUndecodablePng(ihdr)) {
    console.log(
      JSON.stringify({
        level: "warn",
        event: "moderation_undecodable_png",
        ...ihdr,
        timestamp: new Date().toISOString(),
      }),
    );
    return unprocessable();
  }

  // Short-circuit while we're in the OpenAI backoff window. See the
  // `COOLDOWN_MS` block at the top of this file for rationale.
  const now = Date.now();
  if (now < cooldownUntil) {
    return unavailable();
  }

  const dataUrl = `data:${mimeType};base64,${bytesToBase64(imageBytes)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(OPENAI_MODERATION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODERATION_MODEL,
        input: [{ type: "image_url", image_url: { url: dataUrl } }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Distinguish auth failure (revoked key, missing scope) from a
      // genuine OpenAI outage. The body usually carries the
      // human-readable error code; cap at 500 chars to avoid logging
      // the entire response on a 5xx HTML error page.
      const bodyPreview = await response
        .text()
        .then((t) => t.slice(0, 500))
        .catch(() => "");
      console.log(
        JSON.stringify({
          level: "warn",
          event: "openai_moderation_non_ok",
          status: response.status,
          bodyPreview,
          // The IHDR of the payload, when it is a PNG. A 500 here on a
          // PNG encoding the guard above doesn't know about is how a new
          // undecodable combination announces itself; without these
          // fields it is indistinguishable from an OpenAI outage.
          ...(ihdr ?? {}),
          timestamp: new Date().toISOString(),
        }),
      );
      // Enter the cooldown only for upstream-throttle / upstream-outage
      // codes (429 + 5xx). 4xx other than 429 is a request-shape problem
      // on our side (revoked key, malformed payload) — retrying won't
      // hurt OpenAI, so we shouldn't penalise downstream callers either.
      if (response.status === 429 || response.status >= 500) {
        cooldownUntil = Date.now() + COOLDOWN_MS;
      }
      return unavailable();
    }

    const json = (await response.json()) as OpenAIModerationResponse;
    const result = json.results?.[0];
    if (!result) {
      console.log(
        JSON.stringify({
          level: "warn",
          event: "openai_moderation_empty_results",
          timestamp: new Date().toISOString(),
        }),
      );
      return unavailable();
    }

    const classifications = buildClassifications(
      result.category_scores,
      result.category_applied_input_types,
    );

    const decision = decide({
      categories: result.categories,
      scores: result.category_scores,
      appliedInputs: result.category_applied_input_types,
      flaggedByOpenAI: result.flagged,
    });

    return { ...decision, classifications };
  } catch (err) {
    // Surface the failure mode (timeout vs. network vs. parse error)
    // without leaking image bytes — every retry is one fewer mystery
    // 503 in `wrangler tail` during incident response.
    console.log(
      JSON.stringify({
        level: "warn",
        event: "openai_moderation_failed",
        error: err instanceof Error ? err.message : String(err),
        kind:
          err instanceof Error && err.name === "AbortError"
            ? "timeout"
            : "other",
        timestamp: new Date().toISOString(),
      }),
    );
    // Trip the cooldown here too. Reaching this branch means we
    // failed to even *read* an HTTP status from OpenAI — either our
    // `AbortController` fired (upstream slower than `REQUEST_TIMEOUT_MS`
    // ≈ overload) or the connection died outright (DNS / TCP / TLS /
    // transport). Both shapes are the "upstream is unhealthy from this
    // isolate" case the cooldown is meant to dampen. Without this, a
    // hung upstream that times out instead of returning 5xx escapes the
    // backoff entirely and we keep paying the full `REQUEST_TIMEOUT_MS`
    // per request for the whole burst.
    cooldownUntil = Date.now() + COOLDOWN_MS;
    return unavailable();
  } finally {
    clearTimeout(timeout);
  }
}

function unavailable(): ModerationResult {
  return {
    safe: false,
    flaggedForReview: false,
    reason: "Image moderation is temporarily unavailable. Please try again.",
    unavailable: true,
    classifications: [],
  };
}

function unprocessable(): ModerationResult {
  return {
    safe: false,
    flaggedForReview: false,
    reason:
      "This image file could not be read. Re-save it as a standard PNG or JPEG, or pick a different image.",
    unprocessable: true,
    classifications: [],
  };
}
