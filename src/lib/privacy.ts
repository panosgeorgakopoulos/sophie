/** A minimization aid, not an anonymization guarantee. Never persist raw questions. */
export function redactDirectIdentifiers(text: string): string {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[email removed]')
    .replace(/(?:\+\d[\d ().-]{7,}\d|\b\d{10,}\b)/gu, '[telephone removed]')
    .replace(/\b(?:[A-Z]{2}\d{2})(?:\s?[A-Z0-9]){11,30}\b/gu, '[account removed]');
}
