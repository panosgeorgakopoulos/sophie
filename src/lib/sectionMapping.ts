// Exact path segments: French and Greek variants share the widget's stable IDs.
const SECTION_RULES: [RegExp, string][] = [
  [/^\/(?:fr\/)?(?:mathimata-galliko-institouto|cours|cours-de-francais)(\/|$)/i, 'mathimata'],
  [/^\/(?:fr\/)?(?:eksetaseis|examens|diplomes|certifications)(\/|$)/i, 'eksetaseis'],
  [/^\/(?:fr\/)?(?:eksasfalise-spoudes-sti-gallia|etudes-en-france|etudier-en-france)(\/|$)/i, 'spoudes'],
  [/^\/(?:fr\/)?(?:synergeies|cooperation|cooperations)(\/|$)/i, 'synergeies'],
  [/^\/(?:fr\/)?(?:vivliothiki|mediatheque|bibliotheque)(\/|$)/i, 'vivliothiki'],
];
export function mapUrlToSection(url: string): string | undefined {
  try {
    const pathname = decodeURIComponent(new URL(url).pathname);
    return SECTION_RULES.find(([pattern]) => pattern.test(pathname))?.[1];
  } catch { return undefined; }
}
