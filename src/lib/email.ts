import nodemailer from 'nodemailer';
import { z } from 'zod';

/** A single recipient only; no implicit mock-success or recipient/contents logging. */
export async function sendEmail(to: string, subject: string, text: string) {
  if (!z.string().email().max(254).safeParse(to).success || /[\r\n,;]/.test(to)) throw new Error('Invalid email recipient');
  if (!subject || subject.length > 200 || /[\r\n]/.test(subject) || text.length > 50_000) throw new Error('Invalid email content');
  const { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM || !z.string().email().safeParse(SMTP_FROM).success) {
    throw new Error('Email service is not configured');
  }
  const port = Number(process.env.SMTP_PORT || '587');
  if (port !== 465 && port !== 587) throw new Error('SMTP requires a TLS submission port');
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port, secure: port === 465, requireTLS: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
  });
  try {
    const info = await transporter.sendMail({ from: { name: 'IFG Assistant', address: SMTP_FROM }, to, subject, text });
    if (info.rejected?.length || !info.accepted?.length) throw new Error('SMTP did not accept the recipient');
    // Acceptance is not delivery. Do not claim delivery without an outbox/provider receipt.
    return { accepted: true, messageId: info.messageId };
  } finally {
    transporter.close();
  }
}
