// Prompt Assist content script: reads active input, shows relevant Aer contexts, and injects on click
// This script is bundled via webpack into prompt_inject.bundle.js

const nacl = require('tweetnacl');

// Base64 helpers
function b64ToUint8Array(b64) {
  try {
    const binary_string = atob(b64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes;
  } catch (e) {
    return new Uint8Array();
  }
}
function uint8ToB64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function deriveKeyFromUserId(userId) {
  const encoder = new TextEncoder();
  const data = encoder.encode(userId);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hashArr = new Uint8Array(hash);
  const key = hashArr.slice(0, 32); // secretbox key length
  return uint8ToB64(key);
}

function decryptData(enc, secretKeyB64) {
  try {
    if (!enc || !enc.ciphertext || !enc.nonce) return null;
    if (enc.nonce === 'plain') return enc.ciphertext;
    const key = b64ToUint8Array(secretKeyB64);
    const nonce = b64ToUint8Array(enc.nonce);
    const cipher = b64ToUint8Array(enc.ciphertext);
    const opened = nacl.secretbox.open(cipher, nonce, key);
    if (!opened) return null;
    return new TextDecoder().decode(opened);
  } catch (e) {
    return null;
  }
}

// Track current popup state
let assistPopupEl = null;
let lastFocusedEl = null;

function getActiveEditable() {
  const el = document.activeElement;
  if (!el) return null;
  if (el.isContentEditable) return el;
  if (el.tagName === 'TEXTAREA') return el;
  if (el.tagName === 'INPUT') {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (!type || ['text','search','email','url','tel','password'].includes(type)) return el;
  }
  return null;
}

function getActiveInputValue() {
  const el = getActiveEditable();
  if (!el) return '';
  if (el.isContentEditable) return (el.innerText || el.textContent || '').trim();
  return String(el.value || '').trim();
}

function insertTextAtCursor(target, text) {
  if (!target) return false;
  target.focus();
  if (target.isContentEditable) {
    const sel = window.getSelection();
    if (!sel) return false;
    const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : document.createRange();
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    // Move caret after inserted text
    range.setStartAfter(node);
    range.setEndAfter(node);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }
  if (typeof target.selectionStart === 'number' && typeof target.selectionEnd === 'number') {
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const before = target.value.substring(0, start);
    const after = target.value.substring(end);
    const next = before + text + after;
    target.value = next;
    const pos = start + text.length;
    target.selectionStart = target.selectionEnd = pos;
    // Trigger input event
    const evt = new Event('input', { bubbles: true });
    target.dispatchEvent(evt);
    return true;
  }
  // Fallback: append
  if (typeof target.value === 'string') {
    target.value += text;
    const evt = new Event('input', { bubbles: true });
    target.dispatchEvent(evt);
    return true;
  }
  return false;
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '16px',
    right: '16px',
    background: 'rgba(17,17,17,0.95)',
    color: 'white',
    padding: '10px 12px',
    borderRadius: '8px',
    fontSize: '12px',
    zIndex: 2147483647,
    boxShadow: '0 2px 10px rgba(0,0,0,0.25)'
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

function closeAssistPopup() {
  if (assistPopupEl) {
    assistPopupEl.remove();
    assistPopupEl = null;
  }
}

function buildAssistPopup({ results, userId, query }) {
  closeAssistPopup();
  lastFocusedEl = getActiveEditable();

  const container = document.createElement('div');
  assistPopupEl = container;
  Object.assign(container.style, {
    position: 'fixed',
    top: '10%',
    left: '50%',
    transform: 'translateX(-50%)',
    width: 'min(560px, 92vw)',
    maxHeight: '70vh',
    overflow: 'auto',
    background: 'white',
    color: '#0b0f13',
    border: '1px solid rgba(0,0,0,0.1)',
    borderRadius: '12px',
    boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
    padding: '10px',
    zIndex: 2147483647,
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, Apple Color Emoji, Segoe UI Emoji'
  });

  // Header
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.padding = '8px 6px 12px 6px';

  const title = document.createElement('div');
  title.textContent = 'Relevant from Aer';
  title.style.fontWeight = '700';
  title.style.letterSpacing = '-0.01em';
  title.style.fontSize = '14px';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  Object.assign(closeBtn.style, {
    border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '14px', color: '#475569'
  });
  closeBtn.addEventListener('click', closeAssistPopup);
  header.appendChild(closeBtn);

  container.appendChild(header);

  const list = document.createElement('div');
  list.style.display = 'grid';
  list.style.gap = '8px';

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Derive key once
  let derivedKeyB64Promise = deriveKeyFromUserId(userId);

  results.forEach((item, idx) => {
    const card = document.createElement('div');
    Object.assign(card.style, {
      border: '1px solid rgba(0,0,0,0.08)',
      borderRadius: '10px',
      padding: '10px',
      background: 'white'
    });

    const snippet = document.createElement('div');
    snippet.style.fontSize = '12px';
    snippet.style.color = '#111827';
    snippet.style.lineHeight = '1.4';
    snippet.style.display = 'block';
    snippet.style.marginBottom = '8px';

    // Preview: server-provided plaintext (preferred), else decrypt summary/content
    (async () => {
      const keyB64 = await derivedKeyB64Promise;
      let preview = null;
      if (item.previewPlain && item.previewPlain.nonce === 'plain') {
        preview = item.previewPlain.ciphertext;
      }
      if (!preview && item.encryptedSummary) {
        preview = decryptData(item.encryptedSummary, keyB64);
      }
      if (!preview) {
        const content = decryptData(item.encryptedContent, keyB64);
        if (content) preview = content.slice(0, 180) + (content.length > 180 ? '…' : '');
      }
      snippet.textContent = preview || '[Encrypted content – cannot preview]';
    })();

    const meta = document.createElement('div');
    meta.style.fontSize = '11px';
    meta.style.color = '#6b7280';
    meta.style.marginTop = '4px';
    meta.textContent = (item.tags && item.tags.length ? `#${item.tags.slice(0, 3).join(' #')}` : '')
      + (item.url ? `  ·  ${new URL(item.url).hostname}` : '');

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.justifyContent = 'flex-end';
    actions.style.gap = '8px';
    actions.style.marginTop = '8px';

    const insertBtn = document.createElement('button');
    insertBtn.textContent = 'Insert';
    Object.assign(insertBtn.style, {
      background: '#111827', color: 'white', border: '1px solid rgba(0,0,0,0.1)',
      borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', fontSize: '12px'
    });

    insertBtn.addEventListener('click', async () => {
      const keyB64 = await derivedKeyB64Promise;
      let full = decryptData(item.encryptedContent, keyB64) || '';
      const summary = decryptData(item.encryptedSummary, keyB64) || '';
      const preview = (item.previewPlain && item.previewPlain.nonce === 'plain') ? item.previewPlain.ciphertext : '';

      // If only stub (e.g., just Page/URL lines), append whatever extra we have
      const looksStub = typeof full === 'string' && /^(Page:|Title:)/.test(full) && full.trim().split('\n').length <= 3;
      if ((!full || looksStub) && (summary || preview)) {
        const extra = summary || preview;
        // Avoid duplicating if already present
        if (!full || !full.includes(extra.slice(0, 40))) {
          full = `${full ? full + '\n\n' : ''}${extra}`;
        }
      }

      if (!full) {
        showToast('Unable to decrypt this context');
        return;
      }

      // Compose helpful header
      const header = [];
      if (item.url) header.push(`URL: ${item.url}`);
      if (Array.isArray(item.tags) && item.tags.length) header.push(`Tags: ${item.tags.join(', ')}`);
      const headerBlock = header.length ? header.join('\n') + '\n\n' : '';

      const prefix = query && query.length ? `${query}\n\n` : '';
      const payload = `${prefix}Context from Aer — Full content\n${headerBlock}${full}`.trim();
      const target = lastFocusedEl || getActiveEditable();
      const ok = insertTextAtCursor(target, payload);
      if (ok) {
        closeAssistPopup();
        showToast('Inserted Aer context');
      } else {
        showToast('Could not insert into this field');
      }
    });

    card.appendChild(snippet);
    card.appendChild(meta);
    actions.appendChild(insertBtn);
    card.appendChild(actions);
    list.appendChild(card);
  });

  if (!results || results.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'No relevant contexts found.';
    empty.style.fontSize = '12px';
    empty.style.color = '#6b7280';
    empty.style.padding = '8px';
    list.appendChild(empty);
  }

  container.appendChild(list);

  // Close on outside click
  const onClick = (e) => {
    if (!assistPopupEl) return;
    if (!assistPopupEl.contains(e.target)) {
      closeAssistPopup();
      document.removeEventListener('mousedown', onClick, true);
      document.removeEventListener('keydown', onKey, true);
    }
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      closeAssistPopup();
      document.removeEventListener('mousedown', onClick, true);
      document.removeEventListener('keydown', onKey, true);
    }
  };
  document.addEventListener('mousedown', onClick, true);
  document.addEventListener('keydown', onKey, true);

  document.body.appendChild(container);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ ok: true, hasAssist: true });
    return true;
  }
  if (request.action === 'getActiveInputValue') {
    sendResponse({ value: getActiveInputValue() });
    return true;
  }
  if (request.action === 'showAssistPopup') {
    const { results, userId, query } = request;
    buildAssistPopup({ results, userId, query });
    sendResponse({ ok: true });
    return true;
  }
  if (request.action === 'closeAssistPopup') {
    closeAssistPopup();
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

// Auto-assist disabled: use manual right-click "Find relevant info from Aer" instead
