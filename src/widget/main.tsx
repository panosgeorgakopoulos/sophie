import React from 'react';
import { createRoot } from 'react-dom/client';
import ChatWidget from './ChatWidget';
import './widget.css';

// Create a container for the widget and append it to the body
const containerId = 'ifg-chat-widget-container';
let container = document.getElementById(containerId);

if (!container) {
  container = document.createElement('div');
  container.id = containerId;
  document.body.appendChild(container);
}

const root = createRoot(container);

// Pass configuration if needed via data attributes on the script tag
// e.g. <script src="widget.js" data-api-url="https://example.com/api/chat"></script>
const scriptTag = document.currentScript as HTMLScriptElement;
const apiUrl = scriptTag?.getAttribute('data-api-url') || '/api/chat';

root.render(
  <React.StrictMode>
    <ChatWidget apiUrl={apiUrl} />
  </React.StrictMode>
);
