import type { APIRoute } from "astro";
import type { GenerateEvent, ErrorCode } from "~/types/sse-events";
import {
  generationRatelimit,
  getSpendCents,
  spendCapCents,
  incrementSpendCents,
} from "~/lib/redis";
import { verifyTurnstile } from "~/lib/turnstile";
import { newSlug } from "~/lib/slug";
import { ESTIMATED_COST_CENTS } from "~/lib/anthropic";

export const prerender = false;

/**
 * POST /api/generate — streaming SSE endpoint.
 *
 * Gate ordering (cheapest, deniest first — locked in eng review):
 *   1. Parse body + extract Turnstile token         fast, free
 *   2. Check global daily spend cap (Redis GET)     ~5ms
 *   3. Check per-IP rate limit (Redis GET)          ~5ms
 *   4. Verify Turnstile server-side                 ~50ms, spends quota
 *   5. Increment per-IP counter                     ~5ms write
 *   6. Emit SSE { slug } — user sees URL NOW
 *   7. Stream Anthropic (60-180s)                   EXPENSIVE
 *   8. On success: INCR global spend counter atomically
 *   9. On success: write config + html to Blob
 *
 * BYOK (X-Anthropic-Key header set) skips gates 2, 3, 5, 8.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: GenerateEvent) => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const fail = (code: ErrorCode, message: string, retryable = false) => {
        emit({ type: "error", code, message, retryable });
        controller.close();
      };

      // --- 1. Parse request ---
      let body: { pdfText?: string; meta?: unknown; turnstileToken?: string };
      try {
        body = await request.json();
      } catch {
        return fail("internal", "Malformed request body");
      }
      const byokKey = request.headers.get("X-Anthropic-Key") || undefined;
      const ip = clientAddress || request.headers.get("x-forwarded-for") || "unknown";

      // --- 2. Spend cap (house key only) ---
      if (!byokKey) {
        const spent = await getSpendCents();
        if (spent + ESTIMATED_COST_CENTS > spendCapCents()) {
          return fail(
            "spend_cap_hit",
            "Daily free quota reached — try BYOK or come back tomorrow",
          );
        }
      }

      // --- 3. Per-IP rate limit (house key only) ---
      if (!byokKey) {
        const { success, reset } = await generationRatelimit.limit(`ip:${ip}`);
        if (!success) {
          const waitMin = Math.ceil((reset - Date.now()) / 60000);
          return fail(
            "rate_limited",
            `You've hit the free tier limit. Try again in ~${waitMin} min, or paste an Anthropic API key.`,
          );
        }
      }

      // --- 4. Turnstile verify ---
      if (!body.turnstileToken) {
        return fail("turnstile_failed", "Captcha token missing");
      }
      const turnstileOk = await verifyTurnstile(body.turnstileToken, ip);
      if (!turnstileOk) {
        return fail("turnstile_failed", "Captcha verification failed");
      }

      // --- 5. Emit slug up-front so user can save the URL ---
      const slug = newSlug();
      emit({ type: "slug", slug });

      // --- 6-9. TODO: stream Anthropic → validate → render → store ---
      emit({
        type: "error",
        code: "internal",
        message:
          "Generation pipeline is a stub. Next commit wires up Anthropic streaming + ace-study-template rendering + Blob write.",
        retryable: false,
      });

      // On eventual success, we'll:
      //   await incrementSpendCents(actualCostCents);
      //   await storeSite(slug, html, config);
      //   emit({ type: "complete", slug, partial: false });

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
};
