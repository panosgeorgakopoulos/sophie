import nodemailer from 'nodemailer';

// You can configure this with actual SMTP credentials in .env.local
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: parseInt(process.env.SMTP_PORT || '587'),
  auth: {
    user: process.env.SMTP_USER || 'ethereal_user',
    pass: process.env.SMTP_PASS || 'ethereal_pass'
  }
});

export async function sendEmail(to: string, subject: string, text: string) {
  if (!process.env.SMTP_HOST) {
    console.log("-------------------------------------------------");
    console.log(`[MOCK EMAIL] TO: ${to}`);
    console.log(`[MOCK EMAIL] SUBJECT: ${subject}`);
    console.log(`[MOCK EMAIL] BODY:\n${text}`);
    console.log("-------------------------------------------------");
    return { success: true, mocked: true };
  }

  const info = await transporter.sendMail({
    from: '"IFG Assistant" <noreply@ifg.gr>',
    to,
    subject,
    text
  });

  console.log("Message sent: %s", info.messageId);
  return info;
}
