# ace-dot-study

Hosted web app: drop three lecture PDFs, get back an interactive study site
in ~90 seconds. No account. Link-shareable.

Phase 2 of [Ace](https://github.com/TenzinDhonyoe/ace) — the OSS repo is the
component library, renderer, and prompts package that this app is a thin
hosted skin over.

## Status

🏗️ **Scaffolding.** Not yet running. See
[docs/phase2-hosted-plan.md](docs/phase2-hosted-plan.md) for the full plan
and [docs/adrs/](docs/adrs/) for the five architectural decisions.

## Architecture

```
  Browser (Astro + pdf.js lazy-loaded)
     │
     │  POST /api/generate  (SSE)
     ▼
  Vercel Node Function (maxDuration: 300s)
     ├─ Turnstile verify
     ├─ Upstash Redis  — per-IP rate limit + atomic spend counter
     ├─ Anthropic streaming (ace-study-prompts system prompt)
     ├─ ace-study-template renderSite() → HTML string
     └─ Vercel Blob  — write /{slug}/index.html + config.json
     │
     ▼
  ace-dot-study.vercel.app/{slug}  → static HTML from Blob
```

Single Astro app. Frontend pages + API routes in one tree. Imports both
OSS packages (`ace-study-template`, `ace-study-prompts`) from npm.

## Local dev

```bash
bun install
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, Upstash, Blob, Turnstile
bun run dev
# → http://localhost:4321
```

You need:
- Anthropic API key ([console.anthropic.com](https://console.anthropic.com))
- Upstash Redis database ([console.upstash.com](https://console.upstash.com))
- Vercel Blob token ([Vercel dashboard](https://vercel.com))
- Cloudflare Turnstile site + secret key

## Scripts

```bash
bun run dev         # astro dev
bun run build       # astro build
bun run check       # astro check + tsc --noEmit
bun run test        # vitest
bun run lint        # eslint
bun run format      # prettier
```

## Deployment

Push to `main` → Vercel deploys prod. Open a PR → Vercel deploys preview at
`ace-dot-study-git-<branch>-tenzindhonyoe.vercel.app`.

## License

[MIT](./LICENSE).
