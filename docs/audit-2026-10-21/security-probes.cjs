/*
 * Reproduce security control gaps without network, database, SMTP, or real keys.
 * Run from any directory: node docs/audit-2026-10-21/security-probes.cjs
 * These probes assert the audited behavior, not the desired fixed behavior.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
function load(relativePath, mocks = {}, globals = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(js, {
    exports,
    process: { env: {} },
    console: { log() {}, warn() {}, error() {} },
    Buffer, Request, Response, Headers, Date,
    setInterval: () => ({ unref() {} }),
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      throw new Error(`Unmocked import blocked: ${name}`);
    },
    ...globals,
  }, { filename: relativePath });
  return exports;
}

class FakeNextResponse extends Response {
  constructor(body, init) {
    super(body, init);
    this.cookieWrites = [];
    this.cookies = { set: (...args) => this.cookieWrites.push(args) };
  }
  static json(body, init) {
    return new FakeNextResponse(JSON.stringify(body), {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  }
}

const calls = [];
class FakeGoogleGenerativeAI {
  getGenerativeModel() {
    return {
      embedContent: async (text) => {
        calls.push({ operation: 'embed', characters: text.length });
        return { embedding: { values: [0.1, 0.2] } };
      },
      generateContent: async () => {
        calls.push({ operation: 'generate' });
        return { response: { text: () => 'mock draft' } };
      },
      startChat: () => ({
        sendMessage: async () => {
          calls.push({ operation: 'generate' });
          return { response: { text: () => 'mock draft' } };
        },
      }),
    };
  }
}

const database = {
  query: async (sql) => {
    calls.push({ operation: 'sql', sql });
    return { rows: [{
      source_name: 'INTERNAL_POLICY.docx', source_type: 'docx',
      content: 'synthetic internal policy', metadata: {},
    }] };
  },
  pool: {
    query: async (sql) => {
      calls.push({ operation: 'sql', sql });
      return { rows: [{ content: 'synthetic internal policy' }] };
    },
  },
};
const common = {
  'next/server': { NextResponse: FakeNextResponse },
  '@google/generative-ai': { GoogleGenerativeAI: FakeGoogleGenerativeAI },
  '@/lib/db': database,
};
const request = (pathname, body) => new Request(`https://audit.invalid${pathname}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const report = (test, evidence) => console.log(JSON.stringify({ test, ...evidence }));

(async () => {
  // The request intentionally has no cookie, authorization, signature, or Origin.
  const draft = load('src/app/api/draft-email/route.ts', common);
  const draftResponse = await draft.POST(request('/api/draft-email', {
    emailBody: 'x'.repeat(2_000_000),
  }));
  const result = await draftResponse.json();
  assert.equal(draftResponse.status, 200);
  assert.equal(calls[0].characters, 2_000_000);
  assert.equal(result.sources[0].source_name, 'INTERNAL_POLICY.docx');
  report('unauthenticated oversized draft reaches model and all-document SQL', {
    status: draftResponse.status, inputCharacters: calls[0].characters,
    operations: calls.map((c) => c.operation), returnedSource: result.sources[0].source_name,
  });

  const sent = [];
  const webhook = load('src/app/api/webhook/google-form/route.ts', {
    ...common,
    '@/lib/email': { sendEmail: async (...args) => { sent.push(args); return {}; } },
    '@/config/systemPrompt': { SYSTEM_PROMPT: 'mock system prompt' },
  });
  const webhookResponse = await webhook.POST(request('/api/webhook/google-form', {
    studentEmail: 'first@example.invalid,second@example.invalid', studentName: 'Synthetic Student',
  }));
  assert.equal(webhookResponse.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'first@example.invalid,second@example.invalid');
  report('unauthenticated webhook forwards arbitrary recipient list', {
    status: webhookResponse.status, mockedSends: sent.length, recipient: sent[0][0],
  });

  const failingWebhook = load('src/app/api/webhook/google-form/route.ts', {
    ...common,
    '@/lib/email': { sendEmail: async () => { throw new Error('Synthetic SMTP failure'); } },
    '@/config/systemPrompt': { SYSTEM_PROMPT: 'mock system prompt' },
  });
  const failedSendResponse = await failingWebhook.POST(request('/api/webhook/google-form', {
    studentEmail: 'student@example.invalid',
  }));
  const failedSendBody = await failedSendResponse.json();
  assert.equal(failedSendResponse.status, 200);
  assert.equal(failedSendBody.success, true);
  report('SMTP failure still reports success', { status: 200, success: failedSendBody.success });

  const inlineScript = 'fetch(location.origin + "/admin/conversations")';
  const preview = load('src/app/preview/route.ts', {
    'next/server': { NextResponse: FakeNextResponse }, cheerio: require('cheerio'),
  }, {
    fetch: async () => new Response('<html><head>' +
      '<script src="https://thirdparty.invalid/script.js"></script>' +
      '</head><body><script>' + inlineScript + '</script></body></html>'),
  });
  const previewResponse = await preview.GET(new Request('https://app.invalid/preview', {
    headers: { host: 'app.invalid', 'x-forwarded-proto': 'https' },
  }));
  const html = await previewResponse.text();
  assert.ok(html.includes(inlineScript));
  assert.ok(html.includes('https://thirdparty.invalid/script.js'));
  assert.equal(previewResponse.headers.get('Content-Security-Policy'), null);
  report('preview retains upstream scripts under application origin', {
    status: previewResponse.status, inlineScriptPreserved: true,
    externalScriptPreserved: true, routeContentSecurityPolicy: null,
  });

  const rate = load('src/lib/rateLimit.ts');
  let accepted = 0;
  for (let i = 0; i < 30; i++) {
    const req = new Request('https://audit.invalid/api/admin/auth/login', {
      headers: { 'x-forwarded-for': `203.0.113.${i}` },
    });
    if (rate.checkRateLimit(`admin-login:${rate.getClientKey(req)}`, {
      limit: 8, windowMs: 300_000,
    }).success) accepted++;
  }
  assert.equal(accepted, 30);
  report('rotated forwarded headers create independent login buckets', { attempts: 30, accepted });

  const auth = load('src/lib/adminAuth.ts', {
    crypto: require('node:crypto'), bcryptjs: {},
  }, { process: { env: { ADMIN_SESSION_SECRET: 'synthetic-audit-key-never-used-in-production' } } });
  const token = auth.createSessionToken({ id: 'synthetic-user', email: 'staff@example.invalid', name: 'Staff', role: 'staff' });
  assert.ok(auth.verifySessionToken(token));
  const logout = load('src/app/api/admin/auth/logout/route.ts', {
    'next/server': { NextResponse: FakeNextResponse }, '@/lib/adminAuth': auth,
  });
  const logoutResponse = await logout.POST();
  assert.equal(logoutResponse.cookieWrites[0][2].maxAge, 0);
  assert.ok(auth.verifySessionToken(token));
  report('logout clears browser cookie but captured token remains valid', {
    cookieCleared: true, capturedTokenAcceptedAfterLogout: true,
  });
})().catch((error) => { console.error(error); process.exitCode = 1; });
