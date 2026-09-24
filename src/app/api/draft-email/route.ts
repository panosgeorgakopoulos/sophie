import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { query } from '@/lib/db';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy_gemini_key');

const DRAFT_EMAIL_SYSTEM_PROMPT = `
You are an administrative assistant at the French Institute of Greece (IFG). Your task is to draft a response email to a student or parent inquiry based on the provided context (policies, templates).

Strictly emulate the IFG 'MAILS TYPES' templates and adhere to the following rules:

1. Tone: Professional, welcoming, precise, and administrative.
2. Greetings: Always open with a formal address, such as "Αγαπητή/έ κυρία/κύριε [Name]," or "Καλημέρα σας," if the name is unknown (adapt to the language of the email).
3. Sign-offs: Always use a formal sign-off: "Παραμένουμε στη διάθεσή σας. / Με εκτίμηση," at the end of the email (adapt to the language of the email).
4. Formatting: 
   - Use bullet points for listing payment options (e.g., installments vs. full payment).
   - Bold crucial details such as the **IBAN**, **start dates**, and the **10€ placement test fee**.
5. Language: Detect and draft the email in the same language as the incoming email (French, English, or Greek). DO NOT mix languages.
6. Conversation Rules (CRITICAL):
   - When a user asks about course enrollment or pricing, DO NOT immediately dump all the pricing information if details are missing.
   - Before giving a final answer for course registration, the drafted email MUST ask the following clarifying questions if they haven't already provided the information:
     - "Were you a student at the Institut Français de Grèce last year (2025-2026)?"
     - "If not, did you acquire your most recent French diploma (e.g., B1) in the past 2 to 3 years (between 2024 and 2026)?"
   - Why? Briefly explain that this determines if they need an evaluation or qualify for the 5% returning student discount.
7. Evaluation Difference: For Adults, the placement test is an online procedure that costs 10€. For Teens/Ados, the evaluation is a FREE session with one of our professors.
8. Audience Separation: If the sender specifies "Adults" (or 17+), ONLY draft information for Adult classes. NEVER draft information about Teens/Ados unless explicitly requested. The opposite is also true.

Write ONLY the email draft, nothing else. Do not add introductory or concluding remarks outside the email text itself.
`;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { emailBody, senderName = '' } = body;

    if (!emailBody) {
      return NextResponse.json({ error: 'emailBody is required' }, { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-2" });
    const emailModel = genAI.getGenerativeModel({ 
      model: "gemini-3.5-flash",
      systemInstruction: DRAFT_EMAIL_SYSTEM_PROMPT 
    });

    // 1. Generate embedding for user email
    const embeddingResponse = await embeddingModel.embedContent(emailBody);
    const queryEmbedding = embeddingResponse.embedding.values;

    // 2. Retrieve context using raw SQL pgvector distance
    let documents: any[] = [];
    try {
      const dbRes = await query(
        'SELECT id, content, source_type, source_name, metadata FROM documents ORDER BY embedding <-> $1 LIMIT $2',
        [JSON.stringify(queryEmbedding), 8]
      );
      documents = dbRes.rows;
    } catch (err) {
      console.error('Database query failed:', err);
      throw new Error('Database query failed');
    }

    // 3. Assemble retrieved chunks into a context block
    let contextBlock = '';
    if (documents && documents.length > 0) {
      contextBlock = documents.map((doc: any, index: number) => {
        const metadata = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : doc.metadata;
        const sectionHeading = metadata.document_title ? ` - ${metadata.document_title}` : '';
        return `[Source ${index + 1}: ${doc.source_name} (${doc.source_type})${sectionHeading}]\n${doc.content}\n`;
      }).join('\n');
    } else {
      contextBlock = "No relevant context found.";
    }

    // 4. Call Gemini API to generate email draft
    const chatModel = genAI.getGenerativeModel({ 
      model: "gemini-3.5-flash",
      systemInstruction: DRAFT_EMAIL_SYSTEM_PROMPT 
    });

    const prompt = `Context Information from IFG datasets:\n---\n${contextBlock}\n---\n\nDraft an email response to the following inquiry. Use the name "${senderName}" if applicable.\n\nIncoming Email Inquiry:\n${emailBody}`;
    
    const response = await chatModel.generateContent(prompt);
    let draftText = response.response.text();

    // 5. Return the draft and sources
    return NextResponse.json({
      draft: draftText,
      sources: documents ? documents.map((d: any) => ({ source_name: d.source_name, source_type: d.source_type })) : [],
    });

  } catch (error: any) {
    console.error('Draft API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
  }
}
