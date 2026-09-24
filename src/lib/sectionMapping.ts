// Ordered URL-path-pattern rules replacing the old hand-maintained per-section
// URL list. Seeded from the same path prefixes that list previously enumerated
// by hand (mathimata-galliko-institouto, eksetaseis, eksasfalise-spoudes-sti-gallia,
// synergeies, vivliothiki) so the widget's existing category filter pills keep
// working, but now applied to every crawled URL instead of a fixed list. A URL
// that matches none of these still gets ingested (see run_ingestion.ts) --
// just without a section tag, so it's only served for the "All" filter.
const SECTION_RULES: [RegExp, string][] = [
  [/^\/mathimata-galliko-institouto(\/|$)/, 'mathimata'],
  [/^\/eksetaseis(\/|$)/, 'eksetaseis'],
  [/^\/eksasfalise-spoudes-sti-gallia(\/|$)/, 'spoudes'],
  [/^\/synergeies(\/|$)/, 'synergeies'],
  [/^\/vivliothiki(\/|$)/, 'vivliothiki'],
];

export function mapUrlToSection(url: string): string | undefined {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return undefined;
  }
  for (const [pattern, section] of SECTION_RULES) {
    if (pattern.test(pathname)) return section;
  }
  return undefined;
}
