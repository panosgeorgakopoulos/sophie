import fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const API_URL = process.env.TEST_API_URL ?? 'http://localhost:3000/api/chat';

const scenarios = [
  {
    title: 'Scenario A: Adolescents (Greek)',
    questions: [
      "Θέλω να γράψω τον γιο μου (15 ετών) στο Β1",
      "Τι μαθήματα έχετε για εφήβους στο επίπεδο B1;"
    ]
  },
  {
    title: 'Scenario B: Discounts (French)',
    questions: [
      "Je suis un ancien élève de l'institut, je veux payer l'année complète d'avance.",
      "Y a-t-il une réduction pour le paiement intégral et pour un ancien étudiant ?"
    ]
  },
  {
    title: 'Scenario C: Placement Test (Greek)',
    questions: [
      "Είμαι ενήλικας, πήρα το B1 το 2021 και θέλω να συνεχίσω για το B2",
      "Το τελευταίο μου δίπλωμα είναι από το 2021. Πρέπει να δώσω τεστ κατάταξης για να γραφτώ;"
    ]
  }
];

async function runScenarios() {
  console.log('# Chatbot Scenario Test Results\n');
  
  let markdownOutput = '# Chatbot Quality Verification: Multilingual Scenarios\n\n';

  for (const scenario of scenarios) {
    markdownOutput += `## ${scenario.title}\n`;
    
    for (const question of scenario.questions) {
      markdownOutput += `### User Query: \n> "${question}"\n\n`;
      
      try {
        const response = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: question,
            conversation_history: [],
            session_id: 'test_scenario_script'
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        
        markdownOutput += `**Sophie's Reply:**\n\n${data.reply}\n\n`;
        markdownOutput += `---\n\n`;
        
        // Sleep slightly to avoid rate limits on free Gemini tier
        await new Promise(resolve => setTimeout(resolve, 5000));
        
      } catch (error) {
        console.error(`Failed to get response for question: ${question}`, error);
        markdownOutput += `**Error:** Failed to get response.\n\n---\n\n`;
      }
    }
  }

  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync('docs/scenario_results.md', markdownOutput);
  console.log('Finished testing scenarios. Results written to docs/scenario_results.md');
}

runScenarios().catch(console.error);
