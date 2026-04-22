import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/**
 * Upstash Redis client. One instance per cold start — safe for Vercel
 * Fluid Compute (reuses across warm invocations). The REST API is the
 * only transport that works in Edge runtime; we use it everywhere for
 * consistency even though we're on Node.
 */
export const redis = Redis.fromEnv();

/**
 * Per-IP rate limiter. 3 generations per 24h sliding window.
 * BYOK requests bypass this (see ADR 005).
 */
export const generationRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(
    Number(process.env.MAX_GENERATIONS_PER_IP_PER_DAY ?? "3"),
    "24 h",
  ),
  analytics: true,
  prefix: "rl:gen",
});

/**
 * Global daily-spend counter. Atomic INCR on a date-keyed counter with
 * a 25h TTL so the key expires naturally after the day rolls over.
 * Fail closed: if we can't write the counter, reject the request — cost
 * containment beats availability.
 */
export async function incrementSpendCents(cents: number): Promise<number> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const key = `spend:${today}`;
  // Single-command atomic pipeline: INCRBY + EXPIRE NX (set TTL only if
  // it doesn't already have one). Two-round trip but each is atomic; we
  // accept the brief window where the key exists without a TTL.
  const newTotal = await redis.incrby(key, cents);
  if (newTotal === cents) {
    // First increment of the day — set the 25h TTL.
    await redis.expire(key, 25 * 60 * 60);
  }
  return newTotal;
}

/** Read the day's spend without incrementing. Used by /api/generate to
 *  short-circuit before even verifying Turnstile. */
export async function getSpendCents(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const key = `spend:${today}`;
  const v = await redis.get<number>(key);
  return typeof v === "number" ? v : 0;
}

/** Hard ceiling in cents, from env. Defaults to $3/day = 300 cents. */
export function spendCapCents(): number {
  const usd = Number(process.env.MAX_DAILY_ANTHROPIC_USD ?? "3");
  return Math.round(usd * 100);
}
