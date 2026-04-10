const PONDER_URL = process.env.PONDER_URL ?? "http://localhost:42069";

export async function queryPonder<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T | null> {
  try {
    const res = await fetch(PONDER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) return null;

    const json = (await res.json()) as { data?: T; errors?: unknown[] };
    if (json.errors) return null;

    return json.data ?? null;
  } catch {
    return null;
  }
}
