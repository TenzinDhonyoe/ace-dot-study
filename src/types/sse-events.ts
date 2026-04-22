// SSE event types streamed from /api/generate to the client.
// Locked in ADR 001 + ADR 002. Do not add events without updating both
// the worker emitter (src/pages/api/generate.ts) and the client parser
// (src/lib/sse-client.ts) in the same commit.

export type ErrorCode =
  | "rate_limited"
  | "spend_cap_hit"
  | "turnstile_failed"
  | "anthropic_down"
  | "invalid_pdf"
  | "internal";

/** Pipeline stages, in order. */
export type Stage =
  | "reading"    // extracting lecture material, before model call
  | "composing"  // model is streaming the config
  | "rendering"  // server is running renderSite()
  | "storing"    // writing to Blob
  | "done";

export type GenerateEvent =
  /** FIRST event — tells the client where the site will live so they can
   *  copy the URL before generation finishes. */
  | { type: "slug"; slug: string }
  /** Progress signal: stage + approximate completion. `tokensOut` is a
   *  rolling count of output characters from the model (not true tokens —
   *  ~4 chars/token so it's a reasonable proxy). `estMaxTokens` gives the
   *  client a denominator for a progress bar. */
  | {
      type: "progress";
      stage: Stage;
      tokensOut?: number;
      estMaxTokens?: number;
    }
  /** Live narration chunks from the model ("Reading Lecture 3..."). */
  | { type: "narration"; text: string }
  | { type: "section_start"; id: string; title: string }
  | { type: "section_complete"; id: string }
  | { type: "section_failed"; id: string; reason: string }
  | { type: "validation_error"; chunk: string; retry: number }
  /** Terminal success. `partial` true if any section_failed events fired. */
  | { type: "complete"; slug: string; partial: boolean }
  /** Terminal error. Stream ends after this. */
  | { type: "error"; code: ErrorCode; message: string; retryable: boolean };
