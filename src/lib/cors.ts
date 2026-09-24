// Restricts cross-origin access to the exact ifg.gr origin(s) the widget is
// embedded on (plus localhost for dev), instead of a wildcard. The widget is
// designed to be embedded on ifg.gr and call back to wherever this app is
// hosted, so its API routes must be reachable cross-origin -- but only from
// the real site.

function getAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS ?? '';
  const configured = raw.split(',').map((o) => o.trim()).filter(Boolean);
  // Always allow local dev regardless of env config.
  return [...new Set([...configured, 'http://localhost:3000'])];
}

export interface CorsCheck {
  allowed: boolean;
  headers: Record<string, string>;
}

// `origin` is the request's Origin header. No Origin header (e.g. curl,
// server-to-server, same-origin navigation) is allowed through -- CORS only
// governs browser cross-origin fetches, so absence of the header is not an
// attack vector here.
export function checkCors(origin: string | null): CorsCheck {
  if (!origin) {
    return { allowed: true, headers: {} };
  }

  const allowedOrigins = getAllowedOrigins();
  if (!allowedOrigins.includes(origin)) {
    return { allowed: false, headers: {} };
  }

  return {
    allowed: true,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    },
  };
}
