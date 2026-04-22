# ADR 004 — No accounts, no database, no auth in v1

Date: 2026-04-22
Status: accepted

## Context

Every ed-tech adjacent product starts with a login wall. That's where most
of them die. The CEO plan was clear: the wedge is **sharing**, not
monetization. Friction kills sharing.

## Decision

v1 has no user accounts, no login, no password reset, no email
verification, no relational database.

- Identity: none. A generated site is identified by a 12-char nanoid slug.
- Ownership: whoever has the slug URL. "Deletion" requires a signed token
  stored in localStorage at generation time. Lose the token, lose delete
  rights (by design).
- Remix: clones `config.json` from Blob, regenerates, writes under a new
  slug. No ownership check.
- Rate-limiting scoped by IP hash (via Upstash `@upstash/ratelimit`).
- Discoverability: `X-Robots-Tag: noindex` default on every site. Explicit
  opt-in via a toggle on Remix if the creator wants Google to find it.

## Consequences

- Ship in days, not weeks. Auth is boring and slow.
- Abuse surface is real but bounded by the rate-limiter + Turnstile +
  daily spend cap.
- "I lost my link" support tickets are unanswerable. Worth the trade —
  zero-account is the story.
- When v2 adds accounts (trigger: 1000 weekly active generated sites), the
  account becomes a *label* on existing slugs, not a gate. Every slug is
  still valid; a logged-in user sees the ones they've "claimed."
