/**
 * Verify a Cloudflare Turnstile token server-side. Returns true if the
 * token is valid and came from the expected site. Returns false on any
 * failure — we never throw from here; the caller decides the UX.
 *
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */
export async function verifyTurnstile(
  token: string,
  remoteIp: string | undefined,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // If the operator hasn't configured Turnstile, fail closed in prod and
    // open in dev. Matches "you can't forget to wire it" posture.
    if (process.env.NODE_ENV === "production") return false;
    console.warn("TURNSTILE_SECRET_KEY missing — allowing request in dev");
    return true;
  }
  if (!token) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.append("remoteip", remoteIp);

  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body },
    );
    if (!res.ok) return false;
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}
