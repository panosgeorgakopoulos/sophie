# Security probe evidence — 2026-10-21

Run `node docs/audit-2026-10-21/security-probes.cjs` from the repository root.

The probe transpiles the actual audited route/library files, then executes them in isolated VM contexts. Database, Gemini, SMTP, Next response handling, timers, and preview HTTP fetches are mocked. Imports not explicitly permitted are blocked. It reads no environment file, uses no real keys, performs no live network calls, reads or modifies no database, and sends no email. The synthetic document name and recipients are fixtures. Assertions describe defects in the current implementation; they should fail after those defects are repaired.

| Probe | Observed result | Scope and limitation |
|---|---|---|
| Draft route with no authentication and 2,000,000-character body | HTTP 200; embed, SQL, and generation invoked; synthetic internal filename returned | Confirms absent application auth and length controls; production ingress may impose its own body limit. Generated secret extraction was not tested. |
| Webhook with no signature/authentication and comma-separated recipients | HTTP 200; complete recipient list passed to `sendEmail` | Confirms send authorization gap. Actual delivery requires SMTP configuration and working model/DB dependencies. No real email was sent. |
| Webhook whose mocked SMTP fails | HTTP 200, `success: true` | Confirms silent delivery loss, independent of provider delivery behavior. |
| Preview with upstream inline and external scripts | Both preserved; route sends no CSP | Demonstrates executable content retention. No browser code executed. Exploitation requires malicious/compromised upstream script plus a privileged user's visit. An ingress CSP could mitigate. Same-origin access can use `location.origin`, unaffected by the inserted `<base>` tag. |
| 30 requests with distinct caller-supplied `x-forwarded-for` values | All 30 pass the 8-per-5-minute login limit | Confirms trust in headers. Remote exploitability depends on ingress overwriting/sanitizing the header. Process-local state also limits protection independently. |
| Session created, logout invoked, captured token verified again | Logout clears cookie; original token remains valid | Confirms stateless non-revocation. Requires a captured token; not an unauthenticated session-forgery attack. No production token was created or read. |

## Source references

- Unauthenticated drafting, no length checks, universal document retrieval, filename disclosure: [src/app/api/draft-email/route.ts:31-95](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/draft-email/route.ts:31>).
- Unsigned webhook, arbitrary recipient input, send behavior: [src/app/api/webhook/google-form/route.ts:11-26,91-102](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/webhook/google-form/route.ts:11>); [src/lib/email.ts:13-28](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/email.ts:13>).
- Preview trust boundary: [src/app/preview/route.ts:12-35](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/preview/route.ts:12>).
- Forwarded-header trust and process-local rate state: [src/lib/rateLimit.ts:18,31-52](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/rateLimit.ts:18>); login use at [src/app/api/admin/auth/login/route.ts:18-22](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/admin/auth/login/route.ts:18>).
- Session verification and expiry: [src/lib/adminAuth.ts:5,45-60](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/adminAuth.ts:5>); cookie-only logout at [src/app/api/admin/auth/logout/route.ts:4-7](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/admin/auth/logout/route.ts:4>); cookie-only authorization at [src/lib/adminSession.ts:4-7](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/adminSession.ts:4>).

## Additional source-confirmed observations

- Public retrieval checks only optional section and similarity, not publication status or visibility ([src/lib/retrieval.ts:50-80](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/retrieval.ts:50>)); [schema.sql:5-13](</Users/panosgeorgakopoulos/Downloads/sophie/schema.sql:5>) has no such enforced fields. Treat internal documents as public unless explicitly approved; actual confidentiality depends on ingested contents.
- Raw messages and model output are persisted ([src/app/api/chat/route.ts:90-93](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/chat/route.ts:90>)), and unresolved full histories are duplicated without session linkage (`:101-115`). No retention/deletion mechanism was found in the reviewed source/schema. The widget has no privacy notice or privacy-policy link. Legal compliance cannot be concluded solely from repository contents.
- Student name, parent name, age, previous level and discount category enter the Gemini embedding and generation flow ([src/app/api/webhook/google-form/route.ts:30-42,55-88](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/api/webhook/google-form/route.ts:30>)). `studentEmail` itself is passed to SMTP, not explicitly interpolated into that Gemini query. Outlook sends the complete email body ([src/app/outlook/page.tsx:47-63](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/outlook/page.tsx:47>)). Mock email logging prints recipient and complete body ([src/lib/email.ts:14-19](</Users/panosgeorgakopoulos/Downloads/sophie/src/lib/email.ts:14>)).
- Outlook inserts model text as HTML without escaping ([src/app/outlook/page.tsx:91-92](</Users/panosgeorgakopoulos/Downloads/sophie/src/app/outlook/page.tsx:91>)). This permits markup/link/tracking-image injection if generated, while script execution depends on Outlook's own sanitizer and was not asserted.
- Login hashes use bcrypt cost 12; cookie signatures use HMAC and constant-time comparison; production cookies use Secure, HttpOnly and SameSite=Lax. SQL values are parameterized. Chat/admin message rendering uses React text escaping. No claim of SQL injection, cookie forgery, or widget message XSS is supported by the reviewed code.
