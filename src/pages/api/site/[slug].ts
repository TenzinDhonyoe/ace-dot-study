import type { APIRoute } from "astro";
import { isValidSlug } from "~/lib/slug";
import { head } from "@vercel/blob";

export const prerender = false;

/**
 * GET /api/site/[slug] — fetches a generated site's HTML from Blob and
 * proxies it back with `X-Robots-Tag: noindex` so sites stay
 * non-discoverable unless the creator explicitly opts in.
 *
 * In production this could redirect to the Blob URL directly for a single
 * hop, but the proxy lets us enforce the noindex header + serve from the
 * project's origin (better for analytics + future migration to self-hosted
 * storage).
 */
export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug;
  if (!isValidSlug(slug)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const meta = await head(`${slug}/index.html`);
    const res = await fetch(meta.url);
    if (!res.ok) {
      return new Response("Not found", { status: 404 });
    }
    const html = await res.text();
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Robots-Tag": "noindex, nofollow",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
};
