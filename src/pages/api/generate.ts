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
import { ESTIMATED_COST_CENTS, streamGenerate } from "~/lib/anthropic";
import { render } from "~/lib/render";
import { storeSite } from "~/lib/storage";

export const prerender = false;

/**
 * POST /api/generate — streaming SSE endpoint.
 *
 * Gate ordering (cheapest, deniest first — locked in eng review):
 *   1. Parse body + extract Turnstile token         fast, free
 *   2. Check global daily spend cap (Redis GET)     ~5ms
 *   3. Check per-IP rate limit (Redis GET)          ~5ms
 *   4. Verify Turnstile server-side                 ~50ms, spends quota
 *   5. Emit SSE { slug } — user sees URL NOW
 *   6. Stream Anthropic via streamGenerate()        60–180s
 *   7. Render config → HTML via ace-study-template
 *   8. Write config + html to Vercel Blob
 *   9. Increment global spend counter atomically
 *  10. Emit { complete, slug }
 *
 * BYOK (X-Anthropic-Key header set) skips gates 2, 3, 9.
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

      try {
        await runPipeline(request, clientAddress, emit, fail, controller);
      } catch (e) {
        console.error("/api/generate unhandled:", e);
        try {
          fail(
            "internal",
            `Internal error: ${(e as Error).message}`,
            true,
          );
        } catch {
          try {
            controller.close();
          } catch {}
        }
      }
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

async function runPipeline(
  request: Request,
  clientAddress: string | undefined,
  emit: (event: GenerateEvent) => void,
  fail: (code: ErrorCode, message: string, retryable?: boolean) => void,
  controller: ReadableStreamDefaultController,
): Promise<void> {
  {
      // --- 1. Parse request ---
      let body: {
        pdfText?: string;
        meta?: {
          course?: string;
          examDate?: string;
          examFormat?: "mcq-heavy" | "problem-sets" | "mixed" | "essay";
          focusAreas?: string;
          institution?: string;
        };
        turnstileToken?: string;
      };
      try {
        body = await request.json();
      } catch {
        return fail("internal", "Malformed request body");
      }
      if (!body.pdfText || typeof body.pdfText !== "string") {
        return fail("invalid_pdf", "No PDF text provided");
      }
      if (body.pdfText.length > 500_000) {
        return fail(
          "invalid_pdf",
          "Lecture text too long (>500k chars). Split across multiple generations.",
        );
      }

      // Server-side clamp on user-controlled meta fields. Defense in depth
      // even though the client also caps these. focusAreas feeds directly
      // into the model prompt so it's the most sensitive surface.
      if (body.meta?.focusAreas && body.meta.focusAreas.length > 500) {
        body.meta.focusAreas = body.meta.focusAreas.slice(0, 500);
      }
      if (body.meta?.course && body.meta.course.length > 120) {
        body.meta.course = body.meta.course.slice(0, 120);
      }

      const byokKey = request.headers.get("X-Anthropic-Key") || undefined;
      const ip =
        clientAddress || request.headers.get("x-forwarded-for") || "unknown";

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

      // Kick off the progress UI so it's visible before the model
      // produces its first token (TTFT on cold cache is 5-15s).
      emit({ type: "progress", stage: "reading" });
      emit({
        type: "narration",
        text: `Reading ${Math.round(body.pdfText.length / 1000)}k characters of lecture material…\n\n`,
      });

      // --- 6. Stream Anthropic ---
      const apiKey = byokKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return fail("internal", "Server is missing ANTHROPIC_API_KEY");
      }

      let config: unknown = null;
      try {
        for await (const event of streamGenerate(apiKey, {
          pdfText: body.pdfText,
          meta: body.meta,
        })) {
          if (event.type === "__config") {
            config = event.config;
            continue;
          }
          emit(event);
          if (event.type === "error") {
            controller.close();
            return;
          }
        }
      } catch (e) {
        return fail(
          "anthropic_down",
          `Generation failed: ${(e as Error).message}`,
          true,
        );
      }

      if (!config) {
        return fail(
          "internal",
          "Stream ended without a site config. Try again.",
          true,
        );
      }

      // --- 7. Render ---
      emit({ type: "progress", stage: "rendering" });
      let html: string;
      try {
        html = render(config);
      } catch (e) {
        return fail(
          "internal",
          `Rendering failed: ${(e as Error).message}. The generated config didn't match the schema.`,
          true,
        );
      }

      // --- 8. Store to Blob ---
      emit({ type: "progress", stage: "storing" });
      try {
        await storeSite(slug, html, config);
      } catch (e) {
        return fail(
          "internal",
          `Storage failed: ${(e as Error).message}`,
          true,
        );
      }

      // --- 9. Increment spend counter (house key only) ---
      // Fail CLOSED: if this write fails, we've already generated and
      // stored — but the counter is best-effort; logging is enough.
      if (!byokKey) {
        try {
          await incrementSpendCents(ESTIMATED_COST_CENTS);
        } catch (e) {
          console.error("spend-counter write failed:", e);
        }
      }

      // --- 10. Done ---
      emit({ type: "progress", stage: "done" });
      emit({ type: "complete", slug, partial: false });
      controller.close();
  }
}
