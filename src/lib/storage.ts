import { put, head } from "@vercel/blob";

/**
 * Store a fully-rendered site at /{slug}/{index.html,config.json}.
 * Content is world-readable via the returned URLs; slugs are opaque
 * enough (12 chars, 57^12 entropy) that enumeration is impractical.
 *
 * We also set X-Robots-Tag via Content-Disposition-alike headers where
 * possible. Blob's `cacheControlMaxAge` and `addRandomSuffix: false` let
 * us keep stable URLs under the slug.
 */
export async function storeSite(
  slug: string,
  html: string,
  config: unknown,
): Promise<{ htmlUrl: string; configUrl: string }> {
  const htmlResult = await put(`${slug}/index.html`, html, {
    access: "public",
    addRandomSuffix: false,
    contentType: "text/html; charset=utf-8",
    cacheControlMaxAge: 60 * 60, // 1h browser cache
  });

  const configResult = await put(
    `${slug}/config.json`,
    JSON.stringify(config, null, 2),
    {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json; charset=utf-8",
      cacheControlMaxAge: 60 * 60,
    },
  );

  return { htmlUrl: htmlResult.url, configUrl: configResult.url };
}

/** Does a site with this slug exist in Blob? Cheap HEAD check. */
export async function siteExists(slug: string): Promise<boolean> {
  try {
    await head(`${slug}/index.html`);
    return true;
  } catch {
    return false;
  }
}
