import Anthropic from "@anthropic-ai/sdk";
import { systemPrompt, PROMPTS_VERSION } from "ace-study-prompts";
import type { GenerateEvent } from "~/types/sse-events";

/**
 * Model + cost knobs. Claude Sonnet 4.5 hits the quality bar for student
 * review content at roughly a fifth of Opus's cost — the right trade for
 * a $100/mo budget ceiling. Override via ANTHROPIC_MODEL env var to use
 * Opus (claude-opus-4-7) for specific cohorts that need higher quality,
 * or Haiku (claude-haiku-4-5) to stretch the budget further.
 */
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
const MAX_OUTPUT_TOKENS = 16000;

/**
 * Estimated cost per generation in USD cents. Used by the spend-cap gate
 * in /api/generate to short-circuit before burning tokens. Rough average
 * for a 3-PDF sonnet generation with cache hits on the system prompt.
 * Tune with real numbers once production data lands.
 */
export const ESTIMATED_COST_CENTS = 20;

export interface GenerateInput {
  /** Extracted text chunks from user PDFs, already concatenated with
   *  per-lecture headers (e.g. `=== Lecture 3 ===\n<text>`). Client-side
   *  pdf.js does the extraction so we never transport raw binary PDFs. */
  pdfText: string;
  meta?: {
    course?: string;
    examDate?: string;
    institution?: string;
  };
  /** BYOK key override. When set, bypasses the house rate-limit + spend
   *  cap in /api/generate. */
  apiKey?: string;
}

/**
 * Stream a generation. Yields SSE-shaped events (narration + terminal
 * complete/error). The caller forwards each yielded event to the client
 * verbatim.
 *
 * Protocol the model follows (enforced by the shared system prompt +
 * a user-message scaffold):
 *
 *   <plan>
 *   Short, sentence-by-sentence narration the user reads live.
 *   One line per lecture + one line per section.
 *   </plan>
 *   ```json
 *   { full site.config.json }
 *   ```
 *
 * We stream the <plan> content as narration events and buffer the JSON
 * fence for post-stream parsing.
 */
export async function* streamGenerate(
  apiKey: string,
  input: GenerateInput,
): AsyncGenerator<GenerateEvent | { type: "__config"; config: unknown }> {
  const client = new Anthropic({ apiKey });

  // Cache the system prompt. ~8KB, mostly-static, used on every
  // generation — textbook prompt-caching win. 5-minute TTL is fine since
  // generations come in bursts (students cramming) rather than steadily.
  const cachedSystem: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: systemPrompt,
      cache_control: { type: "ephemeral" },
    },
  ];

  const userScaffold = buildUserScaffold(input);

  console.log(
    "[gen] starting stream, model=" + MODEL + ", pdfText=" + input.pdfText.length + " chars",
  );

  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: cachedSystem,
    messages: [{ role: "user", content: userScaffold }],
  });

  // Parser state: we pass through EVERYTHING as narration (stripping
  // `<plan>` and `</plan>` tags), until we see a ```json fence. After
  // that, accumulate into jsonBuffer until the closing fence. This is
  // forgiving: if the model skips the tags, or adds preamble, or puts
  // narration after the JSON, the user still sees useful text.
  let buffer = "";
  let inJson = false;
  let jsonBuffer = "";
  let totalDeltaBytes = 0;
  let narrationEmitted = 0;

  for await (const event of stream) {
    if (
      event.type !== "content_block_delta" ||
      event.delta.type !== "text_delta"
    ) {
      continue;
    }
    const delta = event.delta.text;
    totalDeltaBytes += delta.length;
    buffer += delta;

    if (!inJson) {
      const openFence = buffer.indexOf("```json");
      if (openFence !== -1) {
        // Flush whatever text is before the fence (narration), then switch
        const preText = stripPlanTags(buffer.slice(0, openFence));
        if (preText.trim()) {
          yield { type: "narration", text: preText };
          narrationEmitted += preText.length;
        }
        buffer = buffer.slice(openFence + "```json".length);
        inJson = true;
        continue;
      }
      // Still in narration. Emit sentence-batches to keep the stream
      // feeling typed rather than token-chunked.
      const flush = flushSentences(buffer);
      if (flush.emit) {
        const stripped = stripPlanTags(flush.emit);
        if (stripped.trim()) {
          yield { type: "narration", text: stripped };
          narrationEmitted += stripped.length;
        }
        buffer = flush.rest;
      }
      continue;
    }

    // In JSON: accumulate until the closing fence
    const closeFence = buffer.indexOf("```");
    if (closeFence !== -1) {
      jsonBuffer += buffer.slice(0, closeFence);
      buffer = buffer.slice(closeFence + "```".length);
      inJson = false;
      // Anything after the fence is narration again (usually empty)
    } else {
      jsonBuffer += buffer;
      buffer = "";
    }
  }

  // Stream ended. Flush any trailing narration outside a JSON block.
  if (!inJson && buffer.trim()) {
    const stripped = stripPlanTags(buffer);
    if (stripped.trim()) {
      yield { type: "narration", text: stripped };
      narrationEmitted += stripped.length;
    }
  }

  // If we were mid-JSON without a closing fence, treat the tail as JSON.
  if (inJson && !jsonBuffer) {
    jsonBuffer = buffer;
  } else if (inJson) {
    jsonBuffer += buffer;
  }

  console.log(
    `[gen] stream ended. total deltas: ${totalDeltaBytes}B, narration emitted: ${narrationEmitted}B, json: ${jsonBuffer.length}B`,
  );

  if (!jsonBuffer.trim()) {
    yield {
      type: "error",
      code: "internal",
      message:
        "Model returned no JSON config. Try again, or reduce the number of PDFs.",
      retryable: true,
    };
    return;
  }

  let config: unknown;
  try {
    config = JSON.parse(jsonBuffer.trim());
  } catch (e) {
    console.error("[gen] JSON parse failed. Buffer head:", jsonBuffer.slice(0, 200));
    yield {
      type: "error",
      code: "internal",
      message: `Model returned malformed JSON: ${(e as Error).message}`,
      retryable: true,
    };
    return;
  }

  yield { type: "__config", config };
}

/** Strip `<plan>` and `</plan>` tag markers from a narration chunk. We
 *  don't strictly require the model to use them, but when it does, we
 *  don't want the literal tags appearing in the UI. */
function stripPlanTags(s: string): string {
  return s.replace(/<\/?plan>/g, "");
}

/** Build the user turn. Keeps the PDF text contained in <source_material>
 *  tags so the model can distinguish it from instructions (basic prompt-
 *  injection hardening — the system prompt has the authoritative rules). */
function buildUserScaffold(input: GenerateInput): string {
  const meta = input.meta ?? {};
  const metaLines = [
    meta.course && `Course code: ${meta.course}`,
    meta.examDate && `Exam date: ${meta.examDate}`,
    meta.institution && `Institution: ${meta.institution}`,
  ]
    .filter(Boolean)
    .join("\n");

  return [
    "Compose an Ace study site for this lecture material.",
    metaLines ? `\n${metaLines}` : "",
    "\nBegin with a `<plan>...</plan>` block. Write one sentence per lecture",
    "describing what you're reading, then one sentence per section you're",
    "about to compose. Keep each sentence short — the student reads this live.",
    "",
    "After </plan>, emit the full site.config.json inside a ```json fenced",
    "block. Nothing outside the plan and the JSON fence.",
    "",
    "<source_material>",
    input.pdfText,
    "</source_material>",
  ].join("\n");
}

/** Yield whole sentences from a buffer so narration feels typed, not
 *  chunked by token boundaries. Returns the emit-able prefix + the
 *  un-emitted remainder. */
function flushSentences(buf: string): { emit: string; rest: string } {
  const lastEnd = Math.max(
    buf.lastIndexOf(". "),
    buf.lastIndexOf("? "),
    buf.lastIndexOf("! "),
    buf.lastIndexOf("\n"),
  );
  if (lastEnd === -1) return { emit: "", rest: buf };
  return {
    emit: buf.slice(0, lastEnd + 1),
    rest: buf.slice(lastEnd + 1),
  };
}

export { systemPrompt };
export const PROMPT_VERSION = PROMPTS_VERSION;
