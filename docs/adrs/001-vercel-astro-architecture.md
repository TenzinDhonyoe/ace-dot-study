# ADR 001 — Vercel + Astro for the hosted app

Date: 2026-04-22
Status: accepted
Supersedes: none

## Context

Phase 2 of Ace is a hosted web app where students upload lecture PDFs in the
browser and get back a generated interactive study site. The initial eng plan
(`docs/phase2-hosted-plan.md` in the OSS repo) picked Cloudflare Workers + R2
+ KV + Durable Objects. At scaffold time the maintainer pivoted to Vercel.

## Decision

- **Platform:** Vercel (Pro plan, ~$20/mo).
- **Framework:** Astro 5 with the `@astrojs/vercel` adapter. Astro routes
  double as Vercel Serverless Functions (`src/pages/api/*.ts`), so frontend
  and API live in one app.
- **Runtime:** Node Serverless with Fluid Compute, `maxDuration: 300`.
  Claude generation takes 60–180s; Vercel Edge caps at 25s and is ruled out.
- **Storage:** Vercel Blob for generated sites. R2-equivalent object store
  with public-read URLs + opaque slugs.
- **KV + rate limit:** Upstash Redis (via Vercel KV). `@upstash/ratelimit`
  for per-IP; raw `INCR` for the atomic daily spend counter.

## Consequences

- **Simpler than Cloudflare plan.** Upstash Redis `INCR` is atomic natively,
  so the Durable Object the original plan needed disappears.
- **Vercel handles PR preview deploys for free.** No `deploy.yml` workflow
  to maintain. CI stays narrow: unit tests, typecheck, lint.
- **More expensive at steady state.** Pro is $20/mo vs Cloudflare Workers
  Unbound at ~$5/mo. Acceptable tax for familiar DX, can revisit if volume
  demands it.
- **Lock-in risk is real.** Vercel Blob and Upstash Redis are swappable via
  an adapter layer. Astro + Node Functions can move to any host that runs
  Node. Avoid importing `@vercel/*` from everywhere; keep the surface to
  `src/lib/`.
- **Turnstile still works** (provider-agnostic verify API), so the CAPTCHA
  layer from the original plan carries over unchanged.
