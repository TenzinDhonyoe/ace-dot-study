# ADR 003 — Import generator prompt from `ace-study-prompts`

Date: 2026-04-22
Status: accepted

## Context

The `/ace-review` Claude Code skill in the OSS repo and this hosted app are
two consumers of the same generator logic: widget composition, hard rules,
self-check. If they drift, the eval harness tests one prompt while the
hosted app runs another. That's how quality erodes invisibly.

## Decision

Import the system prompt + self-check from
`ace-study-prompts@^0.1.0`. The OSS package is the upstream:

```ts
import { systemPrompt, selfCheck, PROMPTS_VERSION } from "ace-study-prompts";

const response = await anthropic.messages.stream({
  model: "claude-opus-4-7",
  system: systemPrompt,
  max_tokens: 16000,
  messages: [...]
});
```

## Consequences

- Zero prompt drift. One package, two consumers.
- Eval regressions show up in the OSS repo's nightly runs; the hosted app
  benefits automatically when it bumps the dep.
- `PROMPTS_VERSION` logged on every generation → drift visible in traces.
- If a hosted-app-only prompt tweak is ever needed (e.g., a "web context"
  addendum), model it as a secondary system message appended below the
  shared `systemPrompt`, not as a fork. Preserves the single source of
  truth.
