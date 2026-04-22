import { renderSite } from "ace-study-template";

/**
 * The CDN URLs the generated HTML loads widgets + styles from. Bumping
 * ace-study-components major version requires bumping these in lockstep.
 * See ADR 002.
 */
const COMPONENTS_BUNDLE_URL =
  "https://unpkg.com/ace-study-components@0.2/index.js";
const STYLES_URL = "https://unpkg.com/ace-study-components@0.2/styles.css";

/**
 * Render a validated site.config.json into a complete HTML document.
 * Thin wrapper around the OSS renderer that fixes the asset URLs to our
 * hosted CDN.
 */
export function render(config: unknown): string {
  // renderSite throws on invalid config; let it propagate. The caller
  // wraps the entire pipeline in try/catch and emits an SSE error event.
  return renderSite(config as Parameters<typeof renderSite>[0], {
    componentsBundleUrl: COMPONENTS_BUNDLE_URL,
    stylesUrl: STYLES_URL,
  });
}
