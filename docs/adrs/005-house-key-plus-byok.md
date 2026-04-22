# ADR 005 — Shared house Anthropic key + BYOK escape hatch

Date: 2026-04-22
Status: accepted

## Context

Students don't have Anthropic API keys. They can't bring their own. For the
"drop PDFs, get a site" wedge to work, the app must pay for generation.

But free generations at $0.50–1 each will blow through any reasonable
budget ($100/mo → ~100–200 generations). Two attackers with a script can
drain the budget in an hour. Power users who'd happily pay get throttled.

## Decision

- **Shared house key** for anonymous users. Rate-limited at
  **3 generations per IP per 24h** via `@upstash/ratelimit`.
- **Hard global daily cap:** `MAX_DAILY_ANTHROPIC_USD=3` (configurable).
  Atomic Upstash Redis `INCR` counter, keyed on `spend:YYYY-MM-DD` (UTC)
  with 25h TTL. On hit, `/api/generate` returns HTTP 429 with
  `{ code: "spend_cap_hit" }` and the UI shows "Daily free quota reached —
  try BYOK or tomorrow."
- **BYOK escape hatch:** a `X-Anthropic-Key` header on `/api/generate`
  bypasses both the house rate-limiter and the spend cap. Key is used
  transactionally and never logged, stored, or echoed back. UI: "advanced"
  expando on the upload page with a single password-input field.

## Consequences

- Free tier stays free for the target audience (the one-time-a-semester
  student) without inviting abuse.
- Power users (ed-tech tinkerers, developers evaluating the tool) get
  unlimited access without a throttle by pasting their key.
- Budget is self-bounding. `MAX_DAILY_ANTHROPIC_USD` is the last line of
  defense; rate-limit + Turnstile handle the first 99% of abuse.
- Failure mode to watch: model returns success but we fail to increment
  the counter (Redis write error). Fail **closed** — reject the generation
  if the counter write fails, so cost never exceeds the cap.

## Tuning notes

- $100/mo Anthropic budget ÷ 30 days = $3.33/day ceiling. `MAX_DAILY_USD=3`
  leaves $10/mo headroom for eval runs + overflow.
- Eval harness runs **weekly**, not nightly. Nightly at $2/run × 30 = $60
  would eat 60% of the budget alone.
