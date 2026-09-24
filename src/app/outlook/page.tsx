'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, Send, Edit, RefreshCw } from 'lucide-react';

export default function OutlookTaskpane() {
  const [isOfficeInitialized, setIsOfficeInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailBody, setEmailBody] = useState('');
  const [senderName, setSenderName] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Initialize Office.js
    if (typeof (window as any).Office !== 'undefined') {
      (window as any).Office.onReady((info: any) => {
        if (info.host === (window as any).Office.HostType.Outlook) {
          setIsOfficeInitialized(true);
        }
      });
    }
  }, []);

  const handleGenerateDraft = async () => {
    if (!isOfficeInitialized) {
      setError('Office.js is not initialized. Are you running this in Outlook?');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess(false);

    try {
      // 1. Get the current item (email)
      const item = (window as any).Office.context.mailbox.item;
      
      if (!item) {
        throw new Error('No email item found in the current context.');
      }

      setSenderName(item.sender?.displayName || item.sender?.emailAddress || '');

      // 2. Read the body of the email
      item.body.getAsync((window as any).Office.CoercionType.Text, async (result: any) => {
        if (result.status === (window as any).Office.AsyncResultStatus.Failed) {
          setError('Failed to read email body: ' + result.error.message);
          setLoading(false);
          return;
        }

        const bodyText = result.value;
        setEmailBody(bodyText);

        // 3. Call our Next.js API route to generate the draft
        try {
          const res = await fetch('/api/draft-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emailBody: bodyText, senderName: item.sender?.displayName || '' }),
          });

          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to generate draft');
          
          setDraft(data.draft);
        } catch (apiErr: any) {
          setError(apiErr.message || 'API request failed');
        } finally {
          setLoading(false);
        }
      });
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
      setLoading(false);
    }
  };

  const handleInsertDraft = () => {
    if (!isOfficeInitialized || !draft) return;
    
    const item = (window as any).Office.context.mailbox.item;
    if (!item) return;

    // To insert the draft, we call displayReplyForm to open the reply window and inject the text.
    // Replace newlines with <br> for HTML injection if needed, or use CoercionType.Text if injecting directly.
    // Outlook add-ins have a specific way to reply. displayReplyForm is the standard.
    
    item.displayReplyForm({
      htmlBody: draft.replace(/\n/g, '<br>'),
      callback: (result: any) => {
        if (result.status === (window as any).Office.AsyncResultStatus.Failed) {
          setError('Failed to insert draft: ' + result.error.message);
        } else {
          setSuccess(true);
          setTimeout(() => setSuccess(false), 3000);
        }
      }
    });
  };

  if (!isOfficeInitialized) {
    return (
      <div className="flex items-center justify-center h-full p-4 text-center text-slate-500">
        <p>Loading Outlook integration... Please ensure you are viewing this within an Outlook Taskpane.</p>
      </div>
    );
  }

  return (
    <div className="p-4 h-full flex flex-col bg-slate-50">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-slate-800">IFG Assistant</h1>
        <button 
          onClick={handleGenerateDraft} 
          disabled={loading}
          className="p-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
          title="Generate Draft"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      {error && (
        <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-md border border-red-200">
          {error}
        </div>
      )}

      {success && (
        <div className="p-3 mb-4 text-sm text-green-700 bg-green-100 rounded-md border border-green-200">
          Draft inserted successfully! Review the email before sending.
        </div>
      )}

      <div className="flex-1 overflow-y-auto mb-4 bg-white rounded-md border border-slate-200 shadow-sm p-3">
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-sm">Reading policies & drafting reply...</p>
          </div>
        ) : draft ? (
          <div className="text-sm text-slate-700 whitespace-pre-wrap">
            {draft}
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center text-sm px-4">
            <Edit className="w-8 h-8 mb-2 opacity-50" />
            <p>Click the generate button to read this email and draft a policy-compliant response.</p>
          </div>
        )}
      </div>

      <button
        onClick={handleInsertDraft}
        disabled={loading || !draft}
        className="w-full py-3 px-4 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50 transition-colors font-medium flex items-center justify-center gap-2 shadow-sm"
      >
        <Send className="w-4 h-4" />
        Insert Draft in Reply
      </button>
    </div>
  );
}
