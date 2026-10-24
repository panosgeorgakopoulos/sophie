export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 760, margin: '3rem auto', padding: '1.5rem', lineHeight: 1.7 }}>
      <h1>Sophie — privacy information</h1>
      <p>Please do not submit personal, confidential or sensitive information. Sophie provides approved institutional information and does not need names, applicant records, identity documents or payment details.</p>
      <p>For questions about policies, the application sends the question and approved public facts to the configured Google Gemini service. A basic identifier filter removes recognizable email addresses, telephone numbers and account numbers, but it cannot identify every personal detail. The institution must establish the provider contract, appropriate account configuration and legal basis before public deployment.</p>
      <p>The server stores only the selected institutional topic and language as conversation context, with a 30-minute expiry. It does not store the question or a query embedding in chat analytics. Analytics retain the approved answer, source version identifiers, technical status and optional feedback for up to 30 days, subject to the deployed retention job. Network infrastructure and the AI provider may maintain separate logs under their own configured retention policies.</p>
      <p>The widget keeps displayed messages in the memory of the current page. A random access token in browser session storage lets the server recognize the current conversation. Use “Clear conversation” to remove the server conversation and its associated application analytics, and clear the local messages and token. Automatic expiry blocks further use immediately; the retention job removes expired database rows.</p>
      <p>This technical notice must be supplemented by the Institut Français de Grèce with its controller and data protection contact, legal basis, processor/subprocessor details, international transfer safeguards, rights process and applicable retention policy before deployment. It is not a declaration of legal compliance.</p>
      <p><a href="https://www.ifg.gr/fr/contact/" rel="noreferrer">Contact the Institut Français de Grèce</a></p>
    </main>
  );
}
