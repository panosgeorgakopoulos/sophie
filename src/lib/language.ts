export type SupportedLanguage = 'fr' | 'en' | 'el';

export function detectLanguage(text: string, previous: SupportedLanguage = 'en'): SupportedLanguage {
  if (/[Ͱ-Ͽἀ-῿]/u.test(text)) return 'el';
  if (/[àâçéèêëîïôûùüÿœæ]/iu.test(text) || /\b(le|la|les|des|une|est|vous|bonjour|merci|combien|comment|quel|quelle|son|ses|et|pour|prix|courriel)\b/iu.test(text)) return 'fr';
  if (/\b(the|what|where|when|how|which|please|hello|their|its|and|for|cost)\b/iu.test(text)) return 'en';
  return previous;
}

export const COPY = {
  en: {
    unavailable: "I don't have approved, current evidence for that specific request. Please use the Institute's official contact page for confirmation.",
    clarify: 'Please specify the department or program, audience and period. I cannot safely assign these details to an ambiguous request.',
    heading: 'Approved information',
    privacy: 'Do not include personal or sensitive information. Policy questions may be sent to our AI provider; topic context is retained temporarily. See the privacy notice.',
    fields: { email: 'Email', phone: 'Telephone', address: 'Address', date: 'Date', fee: 'Fee', policy: 'Information', contact: 'Contact' },
  },
  fr: {
    unavailable: "Je ne dispose pas de preuve approuvée et à jour pour cette demande précise. Veuillez utiliser la page de contact officielle de l'Institut pour obtenir une confirmation.",
    clarify: 'Veuillez préciser le service ou le programme, le public concerné et la période. Je ne peux pas attribuer ces informations à une demande ambiguë.',
    heading: 'Informations approuvées',
    privacy: "Ne saisissez pas de données personnelles ou sensibles. Les questions sur les politiques peuvent être transmises à notre fournisseur IA ; le contexte est conservé temporairement. Consultez la notice de confidentialité.",
    fields: { email: 'Courriel', phone: 'Téléphone', address: 'Adresse', date: 'Date', fee: 'Tarif', policy: 'Information', contact: 'Contact' },
  },
  el: {
    unavailable: 'Δεν διαθέτω εγκεκριμένα, επίκαιρα στοιχεία για το συγκεκριμένο αίτημα. Χρησιμοποιήστε την επίσημη σελίδα επικοινωνίας του Ινστιτούτου για επιβεβαίωση.',
    clarify: 'Προσδιορίστε το τμήμα ή το πρόγραμμα, το κοινό και τη χρονική περίοδο. Δεν μπορώ να αποδώσω με ασφάλεια αυτά τα στοιχεία σε ασαφές αίτημα.',
    heading: 'Εγκεκριμένες πληροφορίες',
    privacy: 'Μην καταχωρίζετε προσωπικά ή ευαίσθητα δεδομένα. Ερωτήσεις για πολιτικές ενδέχεται να αποσταλούν στον πάροχο τεχνητής νοημοσύνης· το πλαίσιο διατηρείται προσωρινά. Διαβάστε την ενημέρωση απορρήτου.',
    fields: { email: 'Email', phone: 'Τηλέφωνο', address: 'Διεύθυνση', date: 'Ημερομηνία', fee: 'Κόστος', policy: 'Πληροφορίες', contact: 'Επικοινωνία' },
  },
} as const;
