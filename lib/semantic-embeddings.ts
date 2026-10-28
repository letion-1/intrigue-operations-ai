/**
 * Server-only utility for semantic embeddings.
 * Same provider/model MUST be used for both saved knowledge and user questions.
 * V7 uses OpenRouter's OpenAI embedding model, separate from the free chat model.
 */
// This module must only be imported from server route handlers.

const DIMENSIONS = 1536;
const MODEL = "openai/text-embedding-3-small";

type EmbeddingRow = { index?: number; embedding?: unknown };

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OpenRouter is not configured on the server.");
  if (!texts.length || texts.length > 24 || texts.some(s => !s.trim() || s.length > 4500)) {
    throw new Error("Invalid embedding input size.");
  }
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://intriguestudios.de",
        "X-Title": "INTRIGUE Operations AI",
      },
      body: JSON.stringify({model: MODEL, input: texts}),
      cache: "no-store",
    });
  } catch {
    throw new Error("Could not reach the embeddings provider.");
  }
  if (!response.ok) {
    if (response.status === 402) throw new Error("OpenRouter embeddings need account credit. Existing keyword search still works.");
    if (response.status === 429) throw new Error("Embedding provider is rate-limited. Try again later.");
    throw new Error(`Embedding provider returned ${response.status}.`);
  }
  const body: unknown = await response.json();
  const rows = (body as {data?: EmbeddingRow[]})?.data;
  if (!Array.isArray(rows) || rows.length !== texts.length) throw new Error("Unexpected embedding response.");
  const ordered = [...rows].sort((a,b) => Number(a.index ?? 0) - Number(b.index ?? 0));
  return ordered.map(row => {
    const values = row.embedding;
    if (!Array.isArray(values) || values.length !== DIMENSIONS || !values.every(v => typeof v === "number" && Number.isFinite(v))) {
      throw new Error("Embedding model returned the wrong vector dimensions.");
    }
    return values as number[];
  });
}
