import Anthropic from "@anthropic-ai/sdk";
import { systemPrompt, PROMPTS_VERSION } from "ace-study-prompts";

/**
 * Estimated cost per generation in USD cents. Rough average for a 3-PDF,
 * ~16k output tokens generation on Claude Opus. Used by the spend cap.
 * Tune with real numbers once we have production data.
 */
export const ESTIMATED_COST_CENTS = 60; // $0.60

export interface GenerateInput {
  /** Extracted text from user PDFs, already chunked client-side. */
  pdfText: string;
  /** Optional user-provided metadata (course code, exam date, etc). */
  meta?: {
    course?: string;
    examDate?: string;
    institution?: string;
  };
  /** BYOK key overrides the house key for this request only. */
  apiKey?: string;
}

export function makeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

/**
 * Stream a generation using the shared system prompt. Returns the raw
 * Anthropic streaming response — the caller is responsible for parsing
 * deltas and forwarding them as SSE events.
 *
 * TODO(v0.2): implement. Skeleton only at scaffold time.
 */
export async function* streamGenerate(
  client: Anthropic,
  input: GenerateInput,
): AsyncGenerator<string> {
  throw new Error(
    "anthropic.streamGenerate is a stub. Implement in the next commit.",
  );
  // eslint-disable-next-line no-unreachable
  yield "";
}

export const PROMPT_VERSION = PROMPTS_VERSION;
export { systemPrompt };
