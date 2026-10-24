import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send, User, Bot, AlertCircle, ThumbsUp, ThumbsDown, BookOpen, GraduationCap, Award, Handshake, Library, Trash2 } from 'lucide-react';
import { COPY, detectLanguage, type SupportedLanguage } from '../lib/language';

const SECTIONS = [
  { key: 'all', labels: { el: 'Όλα', fr: 'Tout', en: 'All' }, icon: BookOpen },
  { key: 'mathimata', labels: { el: 'Μαθήματα', fr: 'Cours', en: 'Courses' }, icon: GraduationCap },
  { key: 'eksetaseis', labels: { el: 'Εξετάσεις', fr: 'Examens', en: 'Exams' }, icon: Award },
  { key: 'spoudes', labels: { el: 'Σπουδές', fr: 'Études', en: 'Studies' }, icon: BookOpen },
  { key: 'synergeies', labels: { el: 'Συνέργειες', fr: 'Coopération', en: 'Cooperation' }, icon: Handshake },
  { key: 'vivliothiki', labels: { el: 'Βιβλιοθήκη', fr: 'Médiathèque', en: 'Library' }, icon: Library },
] as const;
const UI = {
  en: { greeting: 'Hello, I am Sophie. Ask me about the Institut Français de Grèce. Please specify the department or program.', placeholder: 'Your question…', send: 'Send', close: 'Close chat', open: 'Open chat', clear: 'Clear conversation', privacy: 'Privacy', contact: 'Contact the Institute', failed: 'The request could not be completed. Please try again.', expired: 'Your conversation expired. Please send your question again.', limited: 'Too many requests. Please wait a moment.', feedback: 'Feedback could not be saved. Please retry.', helpful: 'Helpful', unhelpful: 'Not helpful', evidence: 'Source evidence', loading: 'Looking for approved information…' },
  fr: { greeting: 'Bonjour, je suis Sophie. Posez-moi une question sur l’Institut français de Grèce en précisant le service ou le programme.', placeholder: 'Votre question…', send: 'Envoyer', close: 'Fermer', open: 'Ouvrir la discussion', clear: 'Effacer la conversation', privacy: 'Confidentialité', contact: 'Contacter l’Institut', failed: 'La demande n’a pas abouti. Veuillez réessayer.', expired: 'La conversation a expiré. Veuillez renvoyer votre question.', limited: 'Trop de demandes. Veuillez patienter.', feedback: 'Votre avis n’a pas été enregistré. Réessayez.', helpful: 'Utile', unhelpful: 'Pas utile', evidence: 'Preuve dans la source', loading: 'Recherche d’informations approuvées…' },
  el: { greeting: 'Γεια σας, είμαι η Sophie. Ρωτήστε με για το Γαλλικό Ινστιτούτο Ελλάδος, αναφέροντας το τμήμα ή το πρόγραμμα.', placeholder: 'Η ερώτησή σας…', send: 'Αποστολή', close: 'Κλείσιμο', open: 'Άνοιγμα συνομιλίας', clear: 'Διαγραφή συνομιλίας', privacy: 'Απόρρητο', contact: 'Επικοινωνία με το Ινστιτούτο', failed: 'Το αίτημα δεν ολοκληρώθηκε. Δοκιμάστε ξανά.', expired: 'Η συνομιλία έληξε. Στείλτε ξανά την ερώτησή σας.', limited: 'Πολλά αιτήματα. Περιμένετε λίγο.', feedback: 'Η αξιολόγηση δεν αποθηκεύτηκε. Δοκιμάστε ξανά.', helpful: 'Χρήσιμο', unhelpful: 'Μη χρήσιμο', evidence: 'Τεκμήριο πηγής', loading: 'Αναζήτηση εγκεκριμένων πληροφοριών…' },
};
interface Source { source_name: string; source_type: string; url?: string; version_id?: string; evidence_quote?: string }
interface Message { role: 'user' | 'assistant'; content: string; log_id?: string; feedback_token?: string; rating?: boolean; sources?: Source[] }
interface ChatWidgetProps { apiUrl: string; privacyUrl?: string }
const TOKEN_KEY = 'ifg_chat_token_v2';
function storedToken(): string | undefined {
  try {
    // Old versions persisted raw conversations. Remove those legacy keys.
    sessionStorage.removeItem('ifg_chat_session');
    sessionStorage.removeItem('ifg_chat_session_id');
    const token = sessionStorage.getItem(TOKEN_KEY);
    return token && /^[\w-]{43}$/.test(token) ? token : undefined;
  } catch { return undefined; }
}
function saveToken(token?: string) { try { if (token) sessionStorage.setItem(TOKEN_KEY, token); else sessionStorage.removeItem(TOKEN_KEY); } catch { /* In-memory session still works. */ } }
function initialLanguage(): SupportedLanguage {
  const language = document.documentElement.lang.toLowerCase().slice(0, 2);
  return language === 'fr' || language === 'el' ? language : 'en';
}
function sourceUrl(value?: string): string | undefined {
  try { const url = new URL(value ?? ''); return url.protocol === 'https:' && ['ifg.gr', 'www.ifg.gr'].includes(url.hostname) ? url.href : undefined; } catch { return undefined; }
}

const ChatWidget: React.FC<ChatWidgetProps> = ({ apiUrl, privacyUrl }) => {
  const [language, setLanguage] = useState<SupportedLanguage>(initialLanguage);
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => [{ role: 'assistant', content: UI[initialLanguage()].greeting }]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [sessionToken, setSessionToken] = useState<string | undefined>(storedToken);
  const [selectedSection, setSelectedSection] = useState('all');
  const [pendingFeedback, setPendingFeedback] = useState<string | null>(null);
  const inFlight = useRef(false);
  const feedbackLock = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const ui = UI[language];
  const privacyHref = privacyUrl || new URL('/privacy', new URL(apiUrl, window.location.href)).href;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [messages]);
  useEffect(() => () => activeRequest.current?.abort(), []);

  const handleSend = async () => {
    if (inFlight.current || !input.trim() || input.trim().length > 2000) return;
    inFlight.current = true; // Guards Enter/double clicks before React rerenders.
    const content = input.trim();
    const nextLanguage = detectLanguage(content, language);
    setLanguage(nextLanguage);
    setMessages(previous => [...previous.slice(-98), { role: 'user', content }]);
    setInput(''); setIsLoading(true); setError('');
    const controller = new AbortController();
    activeRequest.current = controller;
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ message: content, session_token: sessionToken, section: selectedSection }) });
      if (response.status === 401) {
        saveToken(); setSessionToken(undefined); setError(UI[nextLanguage].expired); setInput(content); return;
      }
      if (!response.ok) throw new Error(response.status === 429 ? 'limited' : 'failed');
      const data = await response.json();
      if (typeof data.reply !== 'string' || data.reply.length > 6000 || !/^[\w-]{43}$/.test(data.session_token)) throw new Error('failed');
      saveToken(data.session_token); setSessionToken(data.session_token);
      setMessages(previous => [...previous.slice(-99), { role: 'assistant', content: data.reply, log_id: data.log_id, feedback_token: data.feedback_token, sources: Array.isArray(data.sources) ? data.sources.slice(0, 3) : [] }]);
    } catch (caught) { setError(caught instanceof Error && caught.message === 'limited' ? UI[nextLanguage].limited : UI[nextLanguage].failed); setInput(content); }
    finally { clearTimeout(timer); activeRequest.current = null; inFlight.current = false; setIsLoading(false); }
  };

  const handleClear = async () => {
    if (inFlight.current || feedbackLock.current) return;
    inFlight.current = true; setIsLoading(true); setError('');
    try {
      if (sessionToken) {
        const response = await fetch(apiUrl, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_token: sessionToken }), signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error('Clear failed');
      }
      saveToken(); setSessionToken(undefined); setInput(''); setMessages([{ role: 'assistant', content: ui.greeting }]);
    } catch { setError(ui.failed); }
    finally { inFlight.current = false; setIsLoading(false); }
  };

  const handleFeedback = async (message: Message, isHelpful: boolean, index: number) => {
    if (feedbackLock.current || !message.log_id || !message.feedback_token || !sessionToken) return;
    feedbackLock.current = true; setPendingFeedback(message.log_id); setError('');
    try {
      const response = await fetch(apiUrl.replace(/\/api\/chat\/?$/, '/api/feedback'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ log_id: message.log_id, is_helpful: isHelpful, feedback_token: message.feedback_token, session_token: sessionToken }) });
      if (!response.ok) throw new Error('Feedback failed');
      setMessages(previous => previous.map((item, itemIndex) => itemIndex === index && item.log_id === message.log_id ? { ...item, rating: isHelpful } : item));
    } catch { setError(ui.feedback); }
    finally { feedbackLock.current = false; setPendingFeedback(null); }
  };

  return <div className="ifg-widget-wrapper">
    {!isOpen && <button className="ifg-bubble-btn" onClick={() => setIsOpen(true)} aria-label={ui.open}><MessageCircle size={28} /></button>}
    {isOpen && <div className="ifg-chat-window" lang={language}>
      <div className="ifg-chat-header">
        <div className="ifg-header-title"><strong>Sophie</strong><span className="ifg-header-subtitle">Institut Français de Grèce</span></div>
        <div className="ifg-header-actions">
          <span className="ifg-lang-indicator">{language.toUpperCase()}</span>
          <button onClick={handleClear} disabled={isLoading || pendingFeedback !== null} aria-label={ui.clear} title={ui.clear} className="ifg-close-btn"><Trash2 size={17} /></button>
          <button onClick={() => setIsOpen(false)} aria-label={ui.close} className="ifg-close-btn"><X size={20} /></button>
        </div>
      </div>
      <div className="ifg-messages-container" role="log" aria-live="polite" aria-relevant="additions">
        {messages.map((message, index) => <div key={index} className={`ifg-message-wrapper ${message.role === 'user' ? 'ifg-user-wrapper' : 'ifg-assistant-wrapper'}`}>
          <div className={`ifg-message-row ${message.role === 'user' ? 'ifg-user' : 'ifg-assistant'}`}>
            <div className="ifg-avatar">{message.role === 'user' ? <User size={16} /> : <Bot size={16} />}</div><div className="ifg-bubble">{message.content}</div>
          </div>
          {message.sources && message.sources.length > 0 && <div className="ifg-sources-row">{message.sources.map((source, sourceIndex) => <details key={sourceIndex} className="ifg-source-chip">
            <summary>{ui.evidence} {sourceIndex + 1}</summary>
            {sourceUrl(source.url) ? <a href={sourceUrl(source.url)} target="_blank" rel="noopener noreferrer">{source.source_name}</a> : <span>{source.source_name}</span>}
            {source.evidence_quote && <blockquote>{source.evidence_quote}</blockquote>}
          </details>)}</div>}
          {message.log_id && message.feedback_token && <div className="ifg-feedback-row">
            <button className={`ifg-feedback-btn ${message.rating === true ? 'active-up' : ''}`} onClick={() => handleFeedback(message, true, index)} disabled={message.rating !== undefined || pendingFeedback !== null} aria-label={ui.helpful}><ThumbsUp size={12} /></button>
            <button className={`ifg-feedback-btn ${message.rating === false ? 'active-down' : ''}`} onClick={() => handleFeedback(message, false, index)} disabled={message.rating !== undefined || pendingFeedback !== null} aria-label={ui.unhelpful}><ThumbsDown size={12} /></button>
          </div>}
        </div>)}
        {isLoading && <div className="ifg-message-row ifg-assistant"><div className="ifg-avatar"><Bot size={16} /></div><div className="ifg-bubble" role="status">{ui.loading}</div></div>}
        {error && <div className="ifg-error-message" role="alert"><AlertCircle size={14} />{error}</div>}
        <div ref={messagesEndRef} />
      </div>
      <div className="ifg-contact-link-container"><a href="https://www.ifg.gr/fr/contact/" target="_blank" rel="noopener noreferrer" className="ifg-contact-link">{ui.contact}</a></div>
      <div className="ifg-section-selector">{SECTIONS.map(section => { const Icon = section.icon; return <button key={section.key} className={`ifg-section-pill ${selectedSection === section.key ? 'ifg-section-pill--active' : ''}`} onClick={() => setSelectedSection(section.key)} disabled={isLoading} aria-pressed={selectedSection === section.key}><Icon size={13} /><span>{section.labels[language]}</span></button>; })}</div>
      <p className="ifg-privacy-notice">{COPY[language].privacy} <a href={privacyHref} target="_blank" rel="noopener noreferrer">{ui.privacy}</a></p>
      <div className="ifg-input-area">
        <textarea className="ifg-textarea" value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void handleSend(); } }} placeholder={ui.placeholder} aria-label={ui.placeholder} maxLength={2000} rows={1} />
        <button className="ifg-send-btn" onClick={handleSend} disabled={!input.trim() || isLoading} aria-label={ui.send}><Send size={18} /></button>
      </div>
    </div>}
  </div>;
};
export default ChatWidget;
