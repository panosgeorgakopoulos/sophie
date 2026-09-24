import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { pool } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { SYSTEM_PROMPT } from '@/config/systemPrompt';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-2" });
const emailModel = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const {
      studentName,
      studentEmail,
      studentAge,
      parentName,
      previousLevel,
      hasDelfDalf,
      delfDalfDate,
      discountCategory
    } = payload;

    if (!studentEmail) {
      return NextResponse.json({ error: 'studentEmail is required' }, { status: 400 });
    }

    // 1. Create a query string from the payload
    const query = `
      Student Name: ${studentName || 'N/A'}
      Age: ${studentAge || 'N/A'} (Determine if Kids/Teens or Adults based on policies)
      Parent Name: ${parentName || 'N/A'}
      Previous Level: ${previousLevel || 'None'}
      Has DELF/DALF: ${hasDelfDalf ? 'Yes' : 'No'} (Date: ${delfDalfDate || 'N/A'})
      Discount Category: ${discountCategory || 'None'}
      Determine placement test requirements, pricing, and discount rules. Draft an email to this student based on IFG policies.
    `;

    // 2. Embed the query
    const embeddingResult = await embeddingModel.embedContent(query);
    const embedding = embeddingResult.embedding.values;

    // 3. Search vector DB for relevant context
    const dbResult = await pool.query(
      `SELECT content, 1 - (embedding <=> $1::vector) AS similarity 
       FROM documents 
       ORDER BY embedding <=> $1::vector 
       LIMIT 8`,
      [JSON.stringify(embedding)]
    );
    const contextText = dbResult.rows.map((row) => row.content).join('\n\n');

    // 4. Draft Email using Gemini 2.5 Pro
    const prompt = `
      You are IFG Assistant, the administrative assistant for the French Institute of Greece.
      
      Below is the information received from a Google Form submission:
      ${query}

      And here are the relevant policies from the database:
      ${contextText}
      
      Based on the provided form data and policies, please determine:
      1. Which demographic (Kids/Teens vs Adults) this student belongs to.
      2. If they need a placement test (e.g. if their DELF/DALF is older than December 2023, they might need one, check the rules!).
      3. The appropriate pricing and whether their discount category applies.
      
      Draft a professional, welcoming email directly addressing the student (or parent, if it's a child). 
      The email MUST be provided in both Greek and French (one after the other in the same email body).
      Emulate the tone of IFG (formal, precise, administrative).
      Return ONLY the email draft text without any markdown or extra commentary.
    `;

    const chatSession = emailModel.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: SYSTEM_PROMPT }]
        },
        {
          role: "model",
          parts: [{ text: "Understood. I am IFG Assistant. I will adhere to all policies and emulate the IFG persona." }]
        }
      ]
    });

    const response = await chatSession.sendMessage(prompt);
    const draftText = response.response.text();

    // 5. Send the email (mock or real)
    try {
      await sendEmail(studentEmail, 'Bienvenue à l\'IFG / Καλώς ήρθατε στο IFG', draftText);
    } catch (e) {
      console.warn("Failed to send email. SMTP might not be configured.", e);
    }

    return NextResponse.json({ success: true, draft: draftText });

  } catch (err: any) {
    console.error('Google Form Webhook Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
