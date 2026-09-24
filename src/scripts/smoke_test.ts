// Smoke test: confirms the /api/chat endpoint responds non-emptily for a
// spread of real questions across each section. This is NOT a correctness
// check -- it can't verify an answer is factually right, only that the
// pipeline didn't error or return empty. See docs/golden-questions.md for
// the manual review aid that covers actual answer quality.
//
// Previously (run_tests.ts) this script also auto-POSTed is_helpful:true to
// /api/feedback for every response "to trigger the learning loop" --
// unconditionally marking every reply helpful regardless of whether it
// actually was. That's removed: feedback is no longer read by the chat
// route's prompt construction (see src/app/api/chat/route.ts), and blindly
// rating every smoke-test response "helpful" would only pollute the
// analytics signal feedback is now used for.
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const API_URL = process.env.TEST_API_URL ?? 'http://localhost:3000/api/chat';
const DELAY_BETWEEN_REQUESTS_MS = 6500; // stay under the 10 req/min rate limit

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SCENARIOS = [
  { section: 'mathimata', questions: ['Πόσο κοστίζουν τα μαθήματα ενηλίκων;', 'Πότε ξεκινούν τα θερινά τμήματα;'] },
  { section: 'eksetaseis', questions: ['Πότε είναι οι ημερομηνίες για το DELF;', 'Πώς μπορώ να πάρω βεβαίωση επιτυχίας;'] },
  { section: 'spoudes', questions: ['Πώς μπορώ να διεκδικήσω υποτροφία;', 'Τι είναι το Campus France;'] },
  { section: 'synergeies', questions: ['Τι δράσεις υπάρχουν για το βιβλίο;', 'Ποιες είναι οι οπτικοακουστικές συνεργασίες;'] },
  { section: 'vivliothiki', questions: ['Ποιες είναι οι ώρες λειτουργίας της βιβλιοθήκης;', 'Μπορώ να δανειστώ βιβλία;'] },
];

async function runSmokeTest() {
  console.log('--- Smoke Test: /api/chat ---\n');
  let passed = 0;
  let failed = 0;

  for (const scenario of SCENARIOS) {
    console.log(`\n▶ Section: ${scenario.section.toUpperCase()}`);
    for (const question of scenario.questions) {
      console.log(`  Q: ${question}`);
      try {
        const response = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: question,
            conversation_history: [],
            session_id: 'smoke_test_session',
            section: scenario.section,
          }),
        });

        if (!response.ok) {
          console.error(`  ✗ Failed with status: ${response.status}`);
          failed++;
        } else {
          const data = await response.json();
          if (data.reply && data.reply.trim() !== '') {
            console.log(`  ✓ Passed (log_id: ${data.log_id}, ${data.sources?.length ?? 0} source(s))`);
            console.log(`    ${data.reply.substring(0, 80).replace(/\n/g, ' ')}...`);
            passed++;
          } else {
            console.error('  ✗ Failed: empty reply returned');
            failed++;
          }
        }
      } catch (err) {
        console.error(`  ✗ Error: ${err}`);
        failed++;
      }
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runSmokeTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
