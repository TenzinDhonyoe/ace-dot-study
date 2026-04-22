// Ambient shims for OSS packages that ship without TypeScript declarations.
// Eventually ace-study-template and ace-study-prompts should publish .d.ts
// files (tracked in TODOS.md). Until then these stubs keep `astro check`
// green without forcing `any`-typing every callsite.

declare module "ace-study-template" {
  export interface RenderOpts {
    componentsBundleUrl?: string;
    stylesUrl?: string;
  }

  /** See packages/ace-template/src/render.js for the full JSDoc contract. */
  export function renderSite(config: unknown, opts?: RenderOpts): string;
}

declare module "ace-study-prompts" {
  /** The shared generator system prompt. ~8KB. */
  export const systemPrompt: string;

  /** Pre-flight self-check checklist as markdown. */
  export const selfCheck: string;

  /** Semver string. Log alongside generations so drift shows up in traces. */
  export const PROMPTS_VERSION: string;
}
