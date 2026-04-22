# ADR 002 — Import the OSS renderer via `renderSite()`

Date: 2026-04-22
Status: accepted

## Context

The hosted app needs to turn a validated `site.config.json` into an HTML
document served from Blob storage. The `ace-study-template` package in the
OSS repo already exposes `renderSite(config, opts?)` as a pure, runtime-
agnostic function (v0.3.0, confirmed Worker-compatible via tests that reject
any `fs`, `process`, or `require` reference in the function source).

## Decision

Import `renderSite` directly from `ace-study-template@^0.3.0` on npm. Never
fork or copy the renderer into this repo.

The CDN URLs for widgets + styles are fixed at module scope:

```ts
import { renderSite } from "ace-study-template";

const COMPONENTS_BUNDLE_URL = "https://unpkg.com/ace-study-components@0.2/index.js";
const STYLES_URL = "https://unpkg.com/ace-study-components@0.2/styles.css";

export function render(config) {
  return renderSite(config, {
    componentsBundleUrl: COMPONENTS_BUNDLE_URL,
    stylesUrl: STYLES_URL,
  });
}
```

## Consequences

- Zero renderer drift between OSS and hosted. Tests in the OSS repo are
  authoritative.
- Bumping `ace-study-components` to a new major version requires bumping
  both URLs here in lockstep. Flagged as a TODO to automate once versioning
  stabilizes.
- `unpkg.com` is a single point of failure for the widget bundle. If it
  goes down, new page loads fail. Mitigation: cache the bundle in Blob
  at deploy time and rewrite the URLs to self-hosted. Deferred to TODOS —
  current unpkg uptime is good enough for v1.
