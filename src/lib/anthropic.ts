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

  let buffer = "";
  let inPlan = false;
  let inJson = false;
  let jsonBuffer = "";

  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: cachedSystem,
    messages: [{ role: "user", content: userScaffold }],
  });

  for await (const event of stream) {
    if (
      event.type !== "content_block_delta" ||
      event.delta.type !== "text_delta"
    ) {
      continue;
    }
    const delta = event.delta.text;
    buffer += delta;

    // State machine: look for <plan>...</plan> narration, then a JSON
    // fence. We don't bother with a full parser — the tags are
    // unambiguous inside a system-prompted generation.

    if (!inPlan && !inJson) {
      const openPlan = buffer.indexOf("<plan>");
      if (openPlan !== -1) {
        inPlan = true;
        buffer = buffer.slice(openPlan + "<plan>".length);
        continue;
      }
      // Could also open straight into ```json without a plan preamble
      const openFence = buffer.indexOf("```json");
      if (openFence !== -1) {
        inJson = true;
        buffer = buffer.slice(openFence + "```json".length);
        continue;
      }
    }

    if (inPlan) {
      const closePlan = buffer.indexOf("</plan>");
      if (closePlan !== -1) {
        // Flush remaining plan text, then switch out of plan mode
        const tail = buffer.slice(0, closePlan);
        if (tail.trim())
          yield { type: "narration", text: tail };
        buffer = buffer.slice(closePlan + "</plan>".length);
        inPlan = false;
        continue;
      }
      // Emit whole sentences to keep the stream paced naturally
      const flush = flushSentences(buffer);
      if (flush.emit) {
        yield { type: "narration", text: flush.emit };
        buffer = flush.rest;
      }
      continue;
    }

    if (!inJson) {
      const openFence = buffer.indexOf("```json");
      if (openFence !== -1) {
        inJson = true;
        buffer = buffer.slice(openFence + "```json".length);
        continue;
      }
      // Between </plan> and ```json — drop whitespace, keep scanning
      continue;
    }

    // In JSON: accumulate until the closing fence
    const closeFence = buffer.indexOf("```");
    if (closeFence !== -1) {
      jsonBuffer += buffer.slice(0, closeFence);
      buffer = buffer.slice(closeFence + "```".length);
      inJson = false;
    } else {
      jsonBuffer += buffer;
      buffer = "";
    }
  }

  // Stream ended. If we were mid-JSON without a closing fence, the model
  // probably ran out of tokens. Try to parse what we have.
  if (inJson && !jsonBuffer) {
    jsonBuffer = buffer;
  }

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
