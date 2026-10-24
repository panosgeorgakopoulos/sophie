/* Read-only audit probes. Synthetic fixtures; no database or model calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');

function loadTs(relativePath, dependencies = {}) {
  const file = path.join(root, relativePath);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  const run = vm.runInThisContext(
    `(function(require,module,exports,process){${source}\n})`,
    { filename: file },
  );
  run((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected import blocked: ${name}`);
  }, module, module.exports, { env: { RAG_MIN_SIMILARITY: '0.55' } });
  return module.exports;
}

async function main() {
  const { chunkText } = loadTs('src/lib/chunking.ts');
  const { mapUrlToSection } = loadTs('src/lib/sectionMapping.ts');

  const syntheticEmail = 'library@example.invalid';
  const longParagraph = `Département bibliothèque. Contact: ${syntheticEmail} `
    + Array(420).fill('information').join(' ');
  const longChunks = chunkText(longParagraph);
  assert(!longChunks.some((chunk) => chunk.includes(syntheticEmail)));
  assert(!longChunks.some((chunk) => chunk.includes('Contact:')));
  const emailLoss = {
    inputWords: longParagraph.split(/\s+/).length,
    inputEmail: syntheticEmail,
    outputRetainsEmail: longChunks.some((chunk) => chunk.includes(syntheticEmail)),
    outputRetainsContactLabel: longChunks.some((chunk) => chunk.includes('Contact:')),
    secondChunkStart: longChunks[1].slice(0, 95),
  };

  const headingText = 'Département bibliothèque\n\n'
    + Array(395).fill('information').join(' ')
    + `\n\nEmail: ${syntheticEmail} Téléphone: +30 210 0000000`;
  const headingChunks = chunkText(headingText).map((chunk) => ({
    words: chunk.split(/\s+/).length,
    hasDepartment: chunk.includes('Département bibliothèque'),
    hasEmail: chunk.includes(syntheticEmail),
  }));
  assert(headingChunks.some((chunk) => chunk.hasEmail && !chunk.hasDepartment));

  const mappings = [
    'https://www.ifg.gr/eksetaseis/',
    'https://www.ifg.gr/fr/examens/',
  ].map((url) => ({ url, section: mapUrlToSection(url) ?? null }));
  assert.equal(mappings[0].section, 'eksetaseis');
  assert.equal(mappings[1].section, null);

  const captured = {};
  const db = {
    query: async (sql) => {
      if (sql.startsWith('SELECT')) {
        captured.retrievalSql = sql;
        return { rows: [{
          id: 'synthetic-document',
          content: 'The library offers books.',
          source_name: 'https://example.invalid/library/',
          source_type: 'website',
          metadata: {},
          similarity: 0.60,
        }] };
      }
      return { rows: [{ id: 'synthetic-log' }] };
    },
  };
  const retrieval = loadTs('src/lib/retrieval.ts', { '@/lib/db': db });
  const validation = loadTs('src/lib/validation.ts', { zod: require('zod') });
  const prompt = loadTs('src/config/systemPrompt.ts');
  const syntheticPhone = '+30 210 0000000';
  const route = loadTs('src/app/api/chat/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, options }) } },
    '@/lib/gemini': {
      embedText: async (text) => { captured.embeddedText = text; return [0.1]; },
      getChatModel: () => ({
        startChat: (options) => {
          captured.history = options.history;
          return {
            sendMessage: async (text) => {
              captured.generationPrompt = text;
              return { response: { text: () => `Library direct phone: ${syntheticPhone}` } };
            },
          };
        },
      }),
      withGeminiRetry: async (fn) => fn(),
    },
    '@/lib/retrieval': retrieval,
    '@/lib/db': db,
    '@/lib/validation': validation,
    '@/lib/rateLimit': { getClientKey: () => 'fixture', checkRateLimit: () => ({ success: true }) },
    '@/lib/cors': { checkCors: () => ({ allowed: true, headers: {} }) },
    '@/lib/apiError': { toSafeErrorResponse: (error) => { throw error; } },
    '@/config/systemPrompt': prompt,
  });
  const request = new Request('https://example.invalid/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      message: 'Et son numéro ?',
      conversation_history: [
        { role: 'user', content: 'Tell me about the exam department.' },
        { role: 'assistant', content: `The verified direct phone is ${syntheticPhone}.` },
      ],
      section: 'all',
      session_id: 'synthetic-audit-session',
    }),
  });
  const response = await route.POST(request);
  assert.equal(captured.embeddedText, 'Et son numéro ?');
  assert.equal(captured.history[1].role, 'model');
  assert(captured.history[1].parts[0].text.includes(syntheticPhone));
  assert(!captured.generationPrompt.includes(syntheticPhone));
  assert(response.body.reply.includes(syntheticPhone));
  assert.equal(response.body.sources[0].url, 'https://example.invalid/library/');

  console.log(JSON.stringify({
    syntheticFixturesOnly: true,
    liveDatabaseOrModelCalls: 0,
    emailLoss,
    headingChunks,
    mappings,
    route: {
      embeddedText: captured.embeddedText,
      forwardedHistory: captured.history,
      generatedContextContainsPhone: captured.generationPrompt.includes(syntheticPhone),
      returnedReply: response.body.reply,
      returnedSources: response.body.sources,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
