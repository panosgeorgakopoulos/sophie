import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send, User, Bot, AlertCircle, ThumbsUp, ThumbsDown, BookOpen, GraduationCap, Award, Handshake, Library } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

const SECTIONS = [
  { key: 'all',         label: 'Όλα',         labelEn: 'All',        icon: BookOpen },
  { key: 'mathimata',   label: 'Μαθήματα',    labelEn: 'Courses',    icon: GraduationCap },
  { key: 'eksetaseis',  label: 'Εξετάσεις',   labelEn: 'Exams',      icon: Award },
  { key: 'spoudes',     label: 'Σπουδές',     labelEn: 'Studies',    icon: BookOpen },
  { key: 'synergeies',  label: 'Συνέργειες',  labelEn: 'Synergies',  icon: Handshake },
  { key: 'vivliothiki', label: 'Βιβλιοθήκη', labelEn: 'Library',    icon: Library },
] as const;

interface Source {
  source_name: string;
  source_type: string;
  url?: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  log_id?: string;
  rating?: boolean | null;
  sources?: Source[];
}

interface ChatWidgetProps {
  apiUrl: string;
}

// This widget is only ever mounted client-side (a standalone Vite bundle
// injected via <script>, never Next.js SSR -- see src/widget/main.tsx), so
// reading sessionStorage synchronously in lazy useState initializers is safe
// and avoids the extra render + lint error that came from setState-in-effect.
function readOrCreateSessionId(): string {
  let sid = sessionStorage.getItem('ifg_chat_session_id');
  if (!sid) {
    sid = uuidv4();
    sessionStorage.setItem('ifg_chat_session_id', sid);
  }
  return sid;
}

function readInitialMessages(): Message[] {
  const savedSession = sessionStorage.getItem('ifg_chat_session');
  if (savedSession) {
    try {
      return JSON.parse(savedSession);
    } catch (e) {
      console.error('Failed to parse session storage', e);
    }
  }
  return [
    { role: 'assistant', content: 'Bonjour! I am Sophie, the virtual assistant of the Institut Français de Grèce. How can I help you today? / Comment puis-je vous aider ? / Πώς μπορώ να σας βοηθήσω;' },
  ];
}

const ChatWidget: React.FC<ChatWidgetProps> = ({ apiUrl }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(readInitialMessages);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [sessionId] = useState(readOrCreateSessionId);
  const [selectedSection, setSelectedSection] = useState('all');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Save to session storage whenever messages change
    if (messages.length > 0) {
      sessionStorage.setItem('ifg_chat_session', JSON.stringify(messages));
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: Message = { role: 'user', content: input.trim() };
    const updatedMessages = [...messages, userMessage];
    
    setMessages(updatedMessages);
    setInput('');
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          conversation_history: messages.slice(-10), // keep last 10 messages for context
          session_id: sessionId,
          section: selectedSection,
        }),
      });

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }

      const data = await response.json();

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.reply, log_id: data.log_id, rating: null, sources: data.sources }
      ]);

    } catch {
      setError('Sorry, we are having trouble connecting. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFeedback = async (logId: string, isHelpful: boolean, msgIndex: number) => {
    // Update local state immediately
    const updatedMessages = [...messages];
    updatedMessages[msgIndex].rating = isHelpful;
    setMessages(updatedMessages);

    try {
      // Derive the feedback endpoint from apiUrl rather than hardcoding a
      // relative path: when embedded cross-origin (the real ifg.gr use case),
      // a bare "/api/feedback" would resolve against ifg.gr's own origin
      // instead of this app's backend and silently 404.
      const feedbackUrl = apiUrl.replace(/\/api\/chat\/?$/, '/api/feedback');
      await fetch(feedbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ log_id: logId, is_helpful: isHelpful, session_id: sessionId }),
      });
    } catch (e) {
      console.error('Failed to submit feedback', e);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="ifg-widget-wrapper">
      {!isOpen && (
        <button 
          className="ifg-bubble-btn" 
          onClick={() => setIsOpen(true)}
          aria-label="Open chat"
        >
          <MessageCircle size={28} />
        </button>
      )}

      {isOpen && (
        <div className="ifg-chat-window">
          {/* Header */}
          <div className="ifg-chat-header">
            <div className="ifg-header-title">
              <strong>Sophie</strong>
              <span className="ifg-header-subtitle">Institut Français de Grèce</span>
            </div>
            <div className="ifg-header-actions">
              <span className="ifg-lang-indicator" title="Auto-detect FR/EN/GR">FR|EN|GR</span>
              <button onClick={() => setIsOpen(false)} aria-label="Close chat" className="ifg-close-btn">
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Messages Area */}
          <div className="ifg-messages-container">
            {messages.map((msg, idx) => (
              <div key={idx} className={`ifg-message-wrapper ${msg.role === 'user' ? 'ifg-user-wrapper' : 'ifg-assistant-wrapper'}`}>
                <div className={`ifg-message-row ${msg.role === 'user' ? 'ifg-user' : 'ifg-assistant'}`}>
                  <div className="ifg-avatar">
                    {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                  </div>
                  <div className="ifg-bubble">
                    {msg.content}
                  </div>
                </div>
                {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                  <div className="ifg-sources-row">
                    {msg.sources.map((src, sIdx) => (
                      src.url ? (
                        <a
                          key={sIdx}
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ifg-source-chip"
                        >
                          {src.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                        </a>
                      ) : (
                        <span key={sIdx} className="ifg-source-chip ifg-source-chip--static">
                          {src.source_name}
                        </span>
                      )
                    ))}
                  </div>
                )}
                {msg.role === 'assistant' && msg.log_id && (
                  <div className="ifg-feedback-row">
                    <button 
                      className={`ifg-feedback-btn ${msg.rating === true ? 'active-up' : ''}`} 
                      onClick={() => handleFeedback(msg.log_id!, true, idx)}
                      disabled={msg.rating !== undefined && msg.rating !== null}
                      title="Helpful"
                    >
                      <ThumbsUp size={12} />
                    </button>
                    <button 
                      className={`ifg-feedback-btn ${msg.rating === false ? 'active-down' : ''}`} 
                      onClick={() => handleFeedback(msg.log_id!, false, idx)}
                      disabled={msg.rating !== undefined && msg.rating !== null}
                      title="Not Helpful"
                    >
                      <ThumbsDown size={12} />
                    </button>
                  </div>
                )}
              </div>
            ))}
            
            {isLoading && (
              <div className="ifg-message-row ifg-assistant">
                <div className="ifg-avatar"><Bot size={16} /></div>
                <div className="ifg-bubble ifg-loading">
                  <span className="ifg-dot"></span><span className="ifg-dot"></span><span className="ifg-dot"></span>
                </div>
              </div>
            )}
            
            {error && (
              <div className="ifg-error-message">
                <AlertCircle size={14} /> {error}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Contact Person link always visible */}
          <div className="ifg-contact-link-container">
             <a href="https://www.ifg.gr/fr/contact/" target="_blank" rel="noopener noreferrer" className="ifg-contact-link">
               Talk to a person / Contactez-nous
             </a>
          </div>

          {/* Section Selector */}
          <div className="ifg-section-selector">
            {SECTIONS.map((sec) => {
              const Icon = sec.icon;
              return (
                <button
                  key={sec.key}
                  className={`ifg-section-pill ${selectedSection === sec.key ? 'ifg-section-pill--active' : ''}`}
                  onClick={() => setSelectedSection(sec.key)}
                  title={sec.labelEn}
                >
                  <Icon size={13} />
                  <span>{sec.label}</span>
                </button>
              );
            })}
          </div>

          {/* Input Area */}
          <div className="ifg-input-area">
            <textarea
              className="ifg-textarea"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Type your message..."
              rows={1}
            />
            <button 
              className="ifg-send-btn" 
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatWidget;
