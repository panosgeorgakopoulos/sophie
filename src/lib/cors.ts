function getAllowedOrigins(): string[] {
  const values = [process.env.APP_ORIGIN ?? '', ...(process.env.ALLOWED_ORIGINS ?? '').split(',')];
  if (process.env.NODE_ENV !== 'production') values.push('http://localhost:3000');
  return [...new Set(values.map(value => value.trim()).filter(value => {
    try {
      const url = new URL(value);
      return value === url.origin && (url.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && url.protocol === 'http:'));
    } catch { return false; }
  }))];
}
export interface CorsCheck { allowed: boolean; headers: Record<string, string> }

// Public APIs also accept non-browser clients. CORS is not authentication or an abuse control.
export function checkCors(origin: string | null): CorsCheck {
  if (!origin) return { allowed: true, headers: {} };
  if (!getAllowedOrigins().includes(origin)) return { allowed: false, headers: {} };
  return { allowed: true, headers: {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  } };
}
