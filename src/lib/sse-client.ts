import type { GenerateEvent } from "~/types/sse-events";

/**
 * Consume a fetch-based SSE stream. The built-in EventSource API only
 * supports GET, but /api/generate is a POST (body carries the extracted
 * PDF text + Turnstile token), so we read the ReadableStream manually
 * and parse `data: <json>\n\n` frames.
 *
 * Yields `GenerateEvent`s in order. The stream ends when the server
 * closes the response.
 */
export async function* consumeGenerateStream(
  response: Response,
): AsyncGenerator<GenerateEvent> {
  if (!response.ok || !response.body) {
    throw new Error(
      `Generation request failed: ${response.status} ${response.statusText}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // Parse out complete `data: <json>\n\n` frames
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = frame.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          const event = JSON.parse(payload) as GenerateEvent;
          yield event;
        } catch {
          // Malformed frame — skip, keep reading
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
