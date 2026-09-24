import { describe, it, expect } from 'vitest';
import { mapUrlToSection } from './sectionMapping';

describe('mapUrlToSection', () => {
  it.each([
    ['https://www.ifg.gr/mathimata-galliko-institouto/', 'mathimata'],
    ['https://www.ifg.gr/mathimata-galliko-institouto/enilikes/', 'mathimata'],
    ['https://www.ifg.gr/eksetaseis/', 'eksetaseis'],
    ['https://www.ifg.gr/eksetaseis/diplomata/', 'eksetaseis'],
    ['https://www.ifg.gr/eksasfalise-spoudes-sti-gallia/', 'spoudes'],
    ['https://www.ifg.gr/eksasfalise-spoudes-sti-gallia/ypotrofies/', 'spoudes'],
    ['https://www.ifg.gr/synergeies/', 'synergeies'],
    ['https://www.ifg.gr/synergeies/vivlio/', 'synergeies'],
    ['https://www.ifg.gr/vivliothiki/', 'vivliothiki'],
    ['https://www.ifg.gr/vivliothiki/culturetheque/', 'vivliothiki'],
  ])('maps %s -> %s', (url, expected) => {
    expect(mapUrlToSection(url)).toBe(expected);
  });

  it('returns undefined for pages that match no known section', () => {
    expect(mapUrlToSection('https://www.ifg.gr/newsletter/')).toBeUndefined();
    expect(mapUrlToSection('https://www.ifg.gr/branches/')).toBeUndefined();
    expect(mapUrlToSection('https://www.ifg.gr/')).toBeUndefined();
  });

  it('returns undefined for an invalid URL instead of throwing', () => {
    expect(mapUrlToSection('not-a-url')).toBeUndefined();
  });

  it('does not false-positive on a similar but distinct path', () => {
    // Must not match e.g. "/synergeies-something-else/" as "synergeies"
    expect(mapUrlToSection('https://www.ifg.gr/synergeies-archive/')).toBeUndefined();
  });
});
