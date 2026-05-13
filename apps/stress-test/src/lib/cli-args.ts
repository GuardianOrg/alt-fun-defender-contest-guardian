/**
 * Argv-parsing primitives shared by scenarios. Kept narrow — each
 * scenario's `parseOptions` still owns its own option object and flag
 * list, this just collapses the per-flag value extraction.
 */

export function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseRequiredInt(
  flag: string,
  value: string | undefined,
): number {
  const raw = requireValue(flag, value);
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || String(n) !== raw.trim()) {
    throw new Error(`${flag} must be an integer`);
  }
  return n;
}

export function parseRequiredFloat(
  flag: string,
  value: string | undefined,
): number {
  const raw = requireValue(flag, value);
  // `Number()` rejects partial-prefix matches like `"10abc"` (which
  // `Number.parseFloat` would silently parse as `10`) by returning
  // `NaN` for the whole string. Empty / whitespace-only strings
  // coerce to `0` via `Number()`, so we explicitly catch the
  // post-trim empty case before the finite check — otherwise
  // `--bias " "` would silently parse as `0`. CodeRabbit caught the
  // permissive-prefix gap on PR #736.
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(`${flag} must be a number`);
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    throw new Error(`${flag} must be a number`);
  }
  return n;
}

/**
 * Narrow check for the 20-byte EOA / contract address shape. We only
 * use this on user-supplied addresses (not anything that came back
 * from RPC), so syntactic validation is enough — viem's `isAddress`
 * does the same with a checksum check, but pulling viem into the args
 * module would over-couple it for one helper.
 */
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function parseAddress(
  flag: string,
  value: string | undefined,
): `0x${string}` {
  const raw = requireValue(flag, value);
  if (!ADDRESS_RE.test(raw)) {
    throw new Error(`${flag} must be a 0x-prefixed 20-byte hex address`);
  }
  return raw as `0x${string}`;
}
