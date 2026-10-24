/* Read-only audit probes. Does not import the ingestion entry point, load env,
 * call Gemini, or access the database. Run from the repository root:
 *   node docs/audit-2026-10-21/ingestion-probes.cjs
 * Add --local-pdfs for redacted local PDF metrics and --live for public IFG GETs.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const cheerio = require('cheerio');

function evaluate(source) {
  const context = { exports: {}, URL };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return context;
}

const ingestionSource = fs.readFileSync('src/scripts/run_ingestion.ts', 'utf8');
const extractorSource = ingestionSource.slice(
  ingestionSource.indexOf('const CLOUDFLARE_EMAIL_PLACEHOLDER'),
  ingestionSource.indexOf('async function upsertDocumentChunks'),
);
const { extractBodyText } = evaluate(extractorSource);
const { chunkText } = evaluate(fs.readFileSync('src/lib/chunking.ts', 'utf8')).exports;
const { mapUrlToSection } = evaluate(fs.readFileSync('src/lib/sectionMapping.ts', 'utf8')).exports;

async function main() {
  const fixture = '<body><h1>Exam fees</h1><table><thead><tr><th>Diploma</th><th>Price</th></tr></thead><tbody><tr><td><p>DELF A1</p></td><td>100 EUR</td></tr><tr><td>DALF C2</td><td>200 EUR</td></tr></tbody></table><div>EXAM PHONE 12345</div><p>Contact <a href="mailto:exams@example.org">Exam team</a></p></body>';
  const text = 'EXAM DEPARTMENT\n\n' + Array(398).fill('rules').join(' ') + '\n\nexams@example.org\n\nLIBRARY DEPARTMENT\n\nlibrary@example.org';
  const result = {
    extractor: extractBodyText(cheerio.load(fixture)),
    chunks: chunkText(text).map((s, i) => ({
      i, words: s.split(/\s+/).length,
      examHeading: s.includes('EXAM DEPARTMENT'), examContact: s.includes('exams@example.org'),
      libraryHeading: s.includes('LIBRARY DEPARTMENT'), libraryContact: s.includes('library@example.org'),
    })),
    sections: {
      greek: mapUrlToSection('https://www.ifg.gr/eksetaseis/') ?? null,
      french: mapUrlToSection('https://www.ifg.gr/fr/examens/') ?? null,
    },
  };
  if (process.argv.includes('--local-pdfs')) {
    const pdfParse = require('pdf-parse');
    result.pdfParserType = typeof pdfParse;
    result.localPdfs = [];
    for (const file of fs.readdirSync('datasets').filter((f) => /\.pdf$/i.test(f))) {
      // pdf.js 1.x writes font warnings to console.log; keep JSON stdout clean.
      const previousLog = console.log;
      let parsed;
      try {
        console.log = (...args) => console.error(...args);
        parsed = await pdfParse(fs.readFileSync(path.join('datasets', file)));
      } finally {
        console.log = previousLog;
      }
      const text = parsed.text.trim();
      result.localPdfs.push({
        number: result.localPdfs.length + 1, pages: parsed.numpages,
        trimmedChars: text.length, words: text ? text.split(/\s+/).length : 0,
      });
    }
  }
  if (process.argv.includes('--live')) {
    result.live = [];
    for (const url of [
      'https://www.ifg.gr/eksetaseis/dino-eksetaseis-2/',
      'https://www.ifg.gr/fr/examens/',
      'https://www.ifg.gr/epikoinoniste-mazi-mas/',
    ]) {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const $ = cheerio.load(await response.text());
      const emails = $('[data-cfemail]').toArray().map((element) => {
        const bytes = Buffer.from($(element).attr('data-cfemail'), 'hex');
        return Array.from(bytes.subarray(1), (c) => String.fromCharCode(c ^ bytes[0])).join('');
      });
      const generalPhonePresent = /210\s*339\s*8600/.test($('body').text());
      $('nav, header, footer, script, style, noscript, iframe').remove();
      const extracted = extractBodyText($);
      result.live.push({
        url, status: response.status,
        pdfLinks: $('a[href]').toArray().map((e) => $(e).attr('href')).filter((u) => /\.pdf(?:$|\?)/i.test(u)),
        cloudflareEncodedEmails: $('[data-cfemail]').length,
        extractedEmailCount: (extracted.match(/[\w.+-]+@[\w.-]+\.[a-z]+/ig) || []).length,
        extractedWords: extracted.split(/\s+/).length,
        ...(url.includes('epikoinoniste') ? { fallbackEmailPresent: emails.includes('contact@ifg.gr'), fallbackPhonePresent: generalPhonePresent } : {}),
      });
    }
  }
  console.log(JSON.stringify(result, null, 2));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
