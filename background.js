// Complete background.js for Chrome Extension with Upload Fix
// Copy and paste this entire file to replace your current background.js

// ============================================
// CONFIGURATION - UPDATE THESE VALUES
// ============================================
const DEFAULT_API_BASE = 'https://honorable-porpoise-222.convex.site';
const AER_API_ENDPOINT = `${DEFAULT_API_BASE}/api/context/upload`;
const API_TOKEN = ''; // Will be loaded from storage

// Crypto (client-side E2E)
const nacl = require('tweetnacl');
const { encodeBase64, decodeBase64 } = require('tweetnacl-util');

// ============================================
// GLOBAL STATE
// ============================================
const tabStates = new Map();
let extensionSettings = {
  autoUpload: false,
  encryptData: false,
  notifications: true
};

// ============================================
// INITIALIZATION
// ============================================
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] Extension installed/updated');
  
  // Initialize settings
  chrome.storage.local.get(['settings'], (result) => {
    if (result.settings) {
      extensionSettings = result.settings;
    } else {
      chrome.storage.local.set({ settings: extensionSettings });
    }
  });
  
  // Remove all context menus first to avoid duplicate ID errors
  chrome.contextMenus.removeAll(() => {
    // Create context menus
    chrome.contextMenus.create({
      id: 'uploadToAer',
      title: 'Upload to Aer',
      contexts: ['selection', 'page', 'link', 'image']
    });
    chrome.contextMenus.create({
      id: 'uploadFullToAer',
      title: 'Upload Full Page to Aer',
      contexts: ['selection', 'page']
    });
    chrome.contextMenus.create({
      id: 'uploadSummaryToAer',
      title: 'Upload AI Summary to Aer',
      contexts: ['selection', 'page']
    });
    chrome.contextMenus.create({
      id: 'findFromAer',
      title: 'Find relevant info from Aer',
      contexts: ['editable', 'selection']
    });
  });
});

// ============================================
// CORE UPLOAD FUNCTIONALITY - MAIN FIX HERE
// ============================================

async function deriveKeyFromUserIdB64(userId) {
  const enc = new TextEncoder();
  const data = enc.encode(userId);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash).slice(0, 32);
  return encodeBase64(bytes);
}

function encryptWithKeyB64(plaintext, keyB64) {
  const key = decodeBase64(keyB64);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const msg = new TextEncoder().encode(typeof plaintext === 'string' ? plaintext : String(plaintext));
  const boxed = nacl.secretbox(msg, nonce, key);
  return { ciphertext: encodeBase64(boxed), nonce: encodeBase64(nonce) };
}



/**
 * Prepares raw data for upload by ensuring it has the correct field names
 * The API expects: 'content', 'plaintext', or 'encryptedContent'
 */
function prepareDataForUpload(rawData) {
  console.log('[Upload] Preparing data, type:', typeof rawData, 'value:', rawData);
  
  // Handle null/undefined
  if (rawData == null) {
    return { content: '' };
  }
  
  // Handle strings directly
  if (typeof rawData === 'string') {
    return { content: rawData };
  }
  
  // Handle arrays
  if (Array.isArray(rawData)) {
    return { content: JSON.stringify(rawData) };
  }
  
  // Handle objects
  if (typeof rawData === 'object') {
    // Pass-through fields we should preserve
    const passthrough = {};
    const passthroughKeys = ['metadata','timestamp','summaryOnly','tags','encryptedTitle','encryptedSummary','url','fileName','fileType','title'];
    for (const k of passthroughKeys) {
      if (rawData[k] !== undefined) passthrough[k] = rawData[k];
    }

    // If it already has a supported payload, keep it and merge passthrough
    if (rawData.content || rawData.plaintext || rawData.encryptedContent) {
      return { ...rawData, ...passthrough };
    }
    
    // Map 'encrypted' to 'encryptedContent'
    if (rawData.encrypted) {
      return { 
        encryptedContent: rawData.encrypted,
        ...passthrough,
      };
    }
    
    // Check for common content field names and map them to 'content'
    const possibleContentFields = ['text', 'message', 'body', 'data', 'value', 'html'];
    for (const field of possibleContentFields) {
      if (rawData[field] !== undefined) {
        const value = rawData[field];
        return { 
          content: typeof value === 'string' ? value : JSON.stringify(value),
          ...passthrough,
        };
      }
    }
    
    // If no recognized fields, stringify the entire object
    return { content: JSON.stringify(rawData), ...passthrough };
  }
  
  // For any other type, convert to string
  return { content: String(rawData) };
}

/**
 * Main upload function - sends data to Aer API
 * This is the fixed version that ensures data has correct field names
 */
async function uploadToAer(data) {
  try {
    console.log('[Upload] Starting upload with raw data:', data);
    
    // Validate input
    if (!data && data !== 0 && data !== '') {
      throw new Error('No data provided for upload');
    }

    // CRITICAL FIX: Ensure data has the correct format
    let payload = prepareDataForUpload(data);
    
    // Add timestamp if not present
    if (!payload.timestamp) {
      payload.timestamp = Date.now();
    }
    
    // Final validation - must have at least one required field
    if (!payload.content && !payload.plaintext && !payload.encryptedContent) {
      console.error('[Upload] ERROR - Payload missing required fields:', payload);
      console.error('[Upload] Original data was:', data);
      throw new Error('Payload must contain either "content", "plaintext", or "encryptedContent"');
    }

    // Get auth token from storage
    const storage = await chrome.storage.local.get(['authToken', 'token']);
    const authToken = storage.authToken || storage.token || API_TOKEN;

    if (!authToken) {
      throw new Error('No authentication token configured. Please set up authentication first.');
    }

    // Derive client-side encryption key from token (aer_{userId})
    const userId = authToken.startsWith('aer_') ? authToken.substring(4) : null;
    if (!userId) throw new Error('Invalid token format; expected aer_{userId}');
    const keyB64 = await deriveKeyFromUserIdB64(userId);

    // If we have plaintext content, encrypt it client-side
    if (!payload.encryptedContent) {
      const plain = typeof payload.plaintext === 'string' && payload.plaintext.length > 0
        ? payload.plaintext
        : (typeof payload.content === 'string' ? payload.content : '');
      if (plain && plain.length > 0) {
        payload.encryptedContent = encryptWithKeyB64(plain, keyB64);
        // IMPORTANT: for summaryOnly uploads the server needs plaintext
        if (!payload.summaryOnly) {
          delete payload.plaintext;
          delete payload.content;
        }
      }
    }

    // Do not set title on the client; backend will compute/refine and index title

    // Provide a short plaintext preview for server-side AI enrichment (not stored)
    const srcAll = typeof data.plaintext === 'string' ? data.plaintext : (typeof data.content === 'string' ? data.content : '');
    if (!payload.summaryOnly && srcAll && srcAll.trim()) {
      payload.plaintext = srcAll.trim().slice(0, 1200);
    }

    // Do not attach client summary; backend will generate preview/summary

    // If summaryOnly was requested upstream, ensure encryptedContent is just a short summary
    if (payload.summaryOnly && payload.encryptedContent && (data.plaintext || data.content)) {
      const src = typeof data.plaintext === 'string' ? data.plaintext : (typeof data.content === 'string' ? data.content : '');
      const preview = (src || '').trim().slice(0, 500);
      payload.encryptedContent = encryptWithKeyB64(preview, keyB64);
      // Also set encryptedSummary = same preview to improve UI
      payload.encryptedSummary = encryptWithKeyB64(preview, keyB64);
    }

    // Safety net: summaryOnly MUST include plaintext for backend validation
    if (payload.summaryOnly) {
      const existingPlain = typeof payload.plaintext === 'string' ? payload.plaintext.trim() : '';
      if (!existingPlain) {
        const sourcePlain = typeof data.plaintext === 'string' ? data.plaintext : (typeof data.content === 'string' ? data.content : '');
        if (sourcePlain && sourcePlain.trim()) {
          payload.plaintext = sourcePlain.trim().slice(0, 1200);
        }
      }
    }

    // Do NOT set tags on the client; let backend AI generate tags and project

    console.log('[Upload] Final payload to send (E2E):', JSON.stringify({ ...payload, encryptedContent: { ...payload.encryptedContent, ciphertext: 'omitted' } }));

    // Make the API request (dynamic dev/prod base)
    const base = await getApiBaseUrl();
    const response = await fetch(`${base}/api/context/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(payload)
    });

    // Handle response
    const responseText = await response.text();
    console.log('[Upload] Response status:', response.status);
    console.log('[Upload] Response text:', responseText);
    
    if (!response.ok) {
      let errorMessage = `Upload failed (${response.status})`;
      try {
        const errorJson = JSON.parse(responseText);
        errorMessage += `: ${JSON.stringify(errorJson)}`;
      } catch {
        errorMessage += `: ${responseText}`;
      }
      throw new Error(errorMessage);
    }

    // Parse successful response
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      result = { success: true, message: responseText };
    }
    
    console.log('[Upload] Success:', result);
    
    // Show success notification if enabled
    if (extensionSettings.notifications) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon128.png'),
        title: 'Upload Successful',
        message: 'Data uploaded to Aer successfully!'
      });
    }
    
    return result;

  } catch (error) {
    console.error('[Upload] Error:', error);
    console.error('[Upload] Stack:', error.stack);
    
    // Show error notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon128.png'),
      title: 'Upload Failed',
      message: error.message
    });
    
    throw error;
  }
}

// ============================================
// MESSAGE HANDLING - LINE 178 FIX IS HERE
// ============================================
async function getApiBaseUrl() {
  const res = await chrome.storage.local.get(['apiUrl', 'apiBaseUrl']);
  return res.apiUrl || res.apiBaseUrl || DEFAULT_API_BASE;
}

function isRestrictedUrl(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  return lower.startsWith('chrome://') || lower.startsWith('edge://') || lower.startsWith('about:') || lower.startsWith('view-source:') || lower.startsWith('chrome-extension://') || lower.startsWith('file://');
}

async function ensureAssistScripts(tabId, url) {
  if (!tabId) return false;
  // First, ping existing content world
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    if (pong && pong.ok) return true;
  } catch {}
  // Inject only the assist overlay (prompt_inject); the manifest already injects content.js
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['prompt_inject.bundle.js'] });
  } catch (e) { console.warn('[EnsureAssist] inject prompt_inject.bundle.js failed:', e); }
  try {
    const pong2 = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    return !!pong2;
  } catch {
    return false;
  }
}

// ============================================
// AI-assisted relevance filtering (client + server tags)
// ============================================
async function getTagsForText(text, title, authToken, apiBase) {
  try {
    const body = { content: (text || '').toString().slice(0, 6000), title: title || '', totalContexts: 1 };
    const res = await fetch(`${apiBase}/api/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return Array.isArray(data) ? data : (Array.isArray(data.tags) ? data.tags : []);
  } catch { return []; }
}

function tokenize(s) {
  return (s || '').toLowerCase().split(/[^a-z0-9]+/g).filter(w => w && w.length > 2);
}

function topTokens(s, max=30) {
  const stop = new Set(["the","and","for","that","with","this","you","are","was","from","have","has","not","but","all","any","can","your","our","use","using","will","into","about","over","under","more","less","than","then","when","what","why","how","they","them","their","there","here","who","which","also","like","just","into","onto","out","in","on","to","of","a","an","as","is","it","be","or","if","at","by","we","i"]);
  const tokens = tokenize(s).filter(w => !stop.has(w));
  const freq = new Map();
  for (const w of tokens) freq.set(w, (freq.get(w)||0) + 1);
  return Array.from(freq.entries()).sort((a,b)=>b[1]-a[1]).slice(0, max).map(([w])=>w);
}

function filterByFirstHalf(text, tags, title) {
  const raw = (text || '').toString();
  if (!raw.trim()) return raw;
  // Split into blocks by blank lines; keep first half as anchor
  const blocks = raw.split(/\n\s*\n+/g).map(b => b.trim()).filter(Boolean);
  const totalChars = raw.length;
  let target = Math.max(1, Math.floor(blocks.length/2));
  let acc = 0, firstIdx = blocks.length; // compute cut by characters
  for (let i=0;i<blocks.length;i++) { acc += blocks[i].length; if (acc >= totalChars/2) { firstIdx = i+1; break; } }
  const keepAnchor = new Set();
  for (let i=0;i<firstIdx;i++) keepAnchor.add(i);
  const firstHalfText = blocks.slice(0, firstIdx).join('\n\n');
  const keyTokens = new Set(topTokens(firstHalfText, 40));
  const tagSet = new Set((tags||[]).map(t=>t.toLowerCase()));

  function scoreBlock(b) {
    const toks = tokenize(b);
    let score = 0;
    for (const t of toks) if (keyTokens.has(t)) score += 2;
    for (const t of tagSet) if (t && b.toLowerCase().includes(t)) score += 5;
    // down-weight likely side-rail items: very short lines, menu-like
    const lines = b.split(/\n/).filter(Boolean);
    const shortLines = lines.filter(l => tokenize(l).length <= 5).length;
    if (shortLines >= Math.max(1, Math.floor(lines.length*0.6))) score -= 6;
    if (/^new chat$/i.test(b) || /history/i.test(b) || /extensions/i.test(b) || /apps/i.test(b) || /explore/i.test(b) || /settings/i.test(b)) score -= 8;
    // mild boost if block contains conversation role markers
    if (/^(user|assistant|model)[:\-]/im.test(b)) score += 2;
    return score;
  }

  const filtered = [];
  for (let i=0;i<blocks.length;i++) {
    if (keepAnchor.has(i)) { filtered.push(blocks[i]); continue; }
    const sc = scoreBlock(blocks[i]);
    if (sc >= 4) filtered.push(blocks[i]);
  }

  // Deduplicate consecutive identical blocks
  const deduped = filtered.filter((b,i,arr)=> i===0 || b !== arr[i-1]);
  return deduped.join('\n\n');
}

async function aiFilterContentUsingFirstHalf(original, title, authToken, apiBase) {
  try {
    const raw = (original || '').toString();
    if (!raw.trim()) return raw;
    const halfLen = Math.max(200, Math.floor(raw.length/2));
    const firstHalf = raw.slice(0, halfLen);
    const tags = await getTagsForText(firstHalf, title||'', authToken, apiBase);
    return filterByFirstHalf(raw, tags, title||'');
  } catch {
    return original;
  }
}

// ============================================
// Semantic search + client-side relevance ranking
// ============================================
async function semanticSearch(query, authToken, apiBase, limit = 20) {
  const endpointCandidates = [
    `${apiBase}/api/search`,
    `${apiBase}/api/context/search`,
  ];
  let json = { success: false, results: [] };
  let lastErr = null;
  for (const url of endpointCandidates) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ query, limit })
      });
      const data = await res.json().catch(() => ({ success: false }));
      if (res.ok && (data.success || Array.isArray(data.results))) {
        json = { success: true, results: data.results || [] };
        break;
      }
      lastErr = new Error(data?.error || `HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  if (!json.success) throw lastErr || new Error('Semantic search failed');
  return json;
}

function normalizeText(s) {
  return (s || '').toString().toLowerCase();
}

function simpleRelevanceScore(query, item) {
  const q = normalizeText(query);
  const qTokens = new Set(q.split(/[^a-z0-9]+/).filter(Boolean));
  const title = normalizeText(item.title);
  const url = normalizeText(item.url);
  const tags = Array.isArray(item.tags) ? item.tags.map(t => normalizeText(t)) : [];
  const previewPlain = (item.previewPlain && item.previewPlain.nonce === 'plain') ? normalizeText(item.previewPlain.ciphertext) : '';

  let score = 0;
  // Title exact/partial matches
  if (title) {
    if (title.includes(q)) score += 20;
    for (const t of qTokens) if (title.includes(t)) score += 3;
  }
  // Tags overlap
  for (const t of tags) if (qTokens.has(t)) score += 5;
  // URL host hints
  if (url.includes('github') && (q.includes('code') || q.includes('repo'))) score += 2;
  if (url.includes('docs') && q.includes('docs')) score += 2;
  // Preview text overlap (if plaintext available)
  if (previewPlain) {
    if (previewPlain.includes(q)) score += 15;
    else {
      let hits = 0;
      for (const t of qTokens) if (previewPlain.includes(t)) hits++;
      score += Math.min(hits, 5) * 2;
    }
  }
  // Small boost if item has summary
  if (item.encryptedSummary) score += 1;
  // Server-provided score if present
  if (typeof item.score === 'number') score += item.score; // additive combine
  return score;
}

function rankByRelevance(query, items) {
  return (items || [])
    .map(it => ({ ...it, _score: simpleRelevanceScore(query, it) }))
    .sort((a, b) => (b._score || 0) - (a._score || 0));
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Background] Message received:', request);
  
  // Handle upload action - THIS IS THE CRITICAL FIX FOR LINE 178
  if (request.action === 'upload' || request.action === 'saveToAer') {
    (async () => {
      try {
        // Extract data from request in various possible formats
        let dataToUpload = null;
        
        // Try different possible data locations
        if (request.data !== undefined) {
          dataToUpload = request.data;
        } else if (request.content !== undefined) {
          dataToUpload = { content: request.content };
        } else if (request.plaintext !== undefined) {
          dataToUpload = { plaintext: request.plaintext };
        } else if (request.encryptedContent !== undefined) {
          dataToUpload = { encryptedContent: request.encryptedContent };
        } else if (request.text !== undefined) {
          dataToUpload = { content: request.text };
        } else if (request.message !== undefined) {
          dataToUpload = { content: request.message };
        } else if (request.body !== undefined) {
          dataToUpload = { content: request.body };
        } else {
          // Use entire request minus the action field
          const { action, ...restOfRequest } = request;
          dataToUpload = restOfRequest;
        }
        
        console.log('[Background] Data to upload (before prep):', dataToUpload);
        
        // Prepare data with correct format
        dataToUpload = prepareDataForUpload(dataToUpload);

        // If we only have a URL/title stub, enrich with page content via content script
        try {
          const looksStub = typeof dataToUpload.content === 'string' && dataToUpload.content.startsWith('Page: ');
          if ((!dataToUpload.content || looksStub) && sender?.tab?.id) {
            const page = await chrome.tabs.sendMessage(sender.tab.id, { action: 'extractContent' });
            if (page && page.content) {
              dataToUpload.content = `Title: ${page.title}\nURL: ${page.url}\n\n${page.content}`;
            }
          }
        } catch (e) {
          console.warn('[Upload] Could not extract page content:', e);
        }
        
        // Detect source from tab URL and add as tag
        let sourceTags = [];
        if (sender.tab?.url) {
          const url = sender.tab.url.toLowerCase();
          if (url.includes('gemini.google.com') || url.includes('ai.google.com')) sourceTags.push('source:gemini');
          else if (url.includes('claude.ai')) sourceTags.push('source:claude');
          else if (url.includes('chatgpt.com') || url.includes('openai.com')) sourceTags.push('source:chatgpt');
          else if (url.includes('perplexity.ai')) sourceTags.push('source:perplexity');
          else if (url.includes('copilot.microsoft.com')) sourceTags.push('source:copilot');
          else if (url.includes('github.com')) sourceTags.push('source:github');
        }
        // Merge source tags with existing tags
        if (sourceTags.length) {
          dataToUpload.tags = Array.isArray(dataToUpload.tags) ? [...dataToUpload.tags, ...sourceTags] : sourceTags;
        }
        
        // Add metadata from sender if available
        if (sender.tab) {
          dataToUpload.metadata = {
            ...dataToUpload.metadata,
            url: sender.tab.url,
            title: sender.tab.title,
            tabId: sender.tab.id,
            source: 'content_script'
          };
        }
        
        // Always E2E encrypt in uploadToAer
        console.log('[Background] Final data to upload (pre-encrypt):', dataToUpload);
        
        // THIS IS THE FIX FOR LINE 178 - data is now properly formatted and encrypted in uploadToAer
        const result = await uploadToAer(dataToUpload);
        
        sendResponse({ success: true, result });
      } catch (error) {
        console.error('[Background] Error handling upload:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    
    return true; // Keep message channel open for async response
  }
  
  // Assist semantic search for live prompt
  if (request.action === 'assistSearch') {
    (async () => {
      try {
        const query = (request.query || '').toString().trim();
        if (!query || query.length < 3) return sendResponse({ success: true, results: [] });
        const storage = await chrome.storage.local.get(['authToken', 'token', 'apiUrl', 'apiBaseUrl']);
        const authToken = storage.authToken || storage.token || API_TOKEN;
        if (!authToken) throw new Error('No auth token');
        const apiBase = storage.apiUrl || storage.apiBaseUrl || DEFAULT_API_BASE;
        const userId = authToken.startsWith('aer_') ? authToken.substring(4) : '';
        const { results } = await semanticSearch(query, authToken, apiBase, 30);
        const ranked = rankByRelevance(query, results).slice(0, 15);
        sendResponse({ success: true, results: ranked, userId });
      } catch (e) {
        console.error('[AssistSearch] Error:', e);
        sendResponse({ success: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  // Handle other actions
  switch (request.action) {
    case 'getSettings':
      sendResponse({ success: true, settings: extensionSettings });
      break;

    case 'updateSettings':
      extensionSettings = { ...extensionSettings, ...request.settings };
      chrome.storage.local.set({ settings: extensionSettings });
      sendResponse({ success: true });
      break;

    case 'openAuth': {
      const url = chrome.runtime.getURL('auth.html');
      chrome.tabs.create({ url }, () => sendResponse({ success: true }));
      return true;
    }

    case 'checkConnection': {
      chrome.storage.local.get(['authToken', 'token'], (res) => {
        const hasToken = Boolean(res.authToken || res.token);
        sendResponse({ success: true, hasToken });
      });
      return true;
    }

    case 'capture': {
      // Basic capture: upload current page URL/title
      const { url, title } = request;
      const payload = { content: `Page: ${title}\nURL: ${url}`, metadata: { source: 'popup_capture' } };
      uploadToAer(payload)
        .then((result) => sendResponse({ success: true, result }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    case 'testConnection': {
      (async () => {
        try {
          const base = await getApiBaseUrl();
          await fetch(`${base}/api/context/upload`, { method: 'OPTIONS' });
          sendResponse({ success: true, message: 'Connection successful' });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true;
    }

    default:
      sendResponse({ success: false, error: 'Unknown action: ' + request.action });
  }
});

// ============================================
// CONTEXT MENU HANDLING
// ============================================
async function robustExtractPage(tabId) {
  // Try content script first
  try {
    const page = await chrome.tabs.sendMessage(tabId, { action: 'extractContent', full: true, maxLen: 200000 });
    if (page && page.content && page.content.length > 0) {
      return page;
    }
  } catch (e) {
    console.warn('[Extract] content.js pathway failed, falling back to scripting:', e);
  }

  // Fallback: execute in page context
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        try {
          const prune = (root) => {
            const sel = 'script, style, nav, header, footer, aside, [role="navigation"], [role="complementary"], [aria-label*="history" i], [aria-label*="conversations" i], [aria-label*="right" i], [aria-label*="extensions" i], [aria-label*="apps" i], [aria-label*="explore" i], [aria-label*="settings" i], iframe, noscript, svg, canvas, video, audio';
            root.querySelectorAll(sel).forEach((el) => el.remove());
          };
          const clone = document.body.cloneNode(true);
          prune(clone);
          const text = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
          const content = text.substring(0, 200000);
          return { title: document.title, url: location.href, content };
        } catch (e) {
          return { title: document.title, url: location.href, content: '' };
        }
      },
    });
    return result;
  } catch (e) {
    console.warn('[Extract] scripting fallback failed:', e);
    return { title: tab?.title || '', url: tab?.url || '', content: '' };
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'uploadToAer' || info.menuItemId === 'uploadFullToAer') {
    let dataToUpload = {};
    
    if (info.selectionText) {
      dataToUpload.content = info.selectionText;
    } else if (info.linkUrl) {
      dataToUpload.content = `Link: ${info.linkUrl}`;
    } else if (info.srcUrl) {
      dataToUpload.content = `Image: ${info.srcUrl}`;
    } else {
      // Enrich with extracted page content (robust)
      try {
        if (tab?.id) {
          const page = await robustExtractPage(tab.id);
          if (page && page.content && page.content.length > 0) {
            let mainText = page.content;
            // If Gemini page, apply AI relevance filter against first half
            const isGemini = (tab?.url||'').toLowerCase().includes('gemini.google.com') || (tab?.url||'').toLowerCase().includes('ai.google.com');
            if (isGemini && info.menuItemId === 'uploadFullToAer') {
              try {
                const storage = await chrome.storage.local.get(['authToken','token','apiUrl','apiBaseUrl']);
                const authToken = storage.authToken || storage.token || API_TOKEN;
                const apiBase = storage.apiUrl || storage.apiBaseUrl || DEFAULT_API_BASE;
                if (authToken) {
                  mainText = await aiFilterContentUsingFirstHalf(mainText, page.title, authToken, apiBase);
                }
              } catch {}
            }
            dataToUpload.content = `Title: ${page.title}\nURL: ${page.url}\n\n${mainText}`;
          } else {
            dataToUpload.content = `Page: ${tab.title}\nURL: ${tab.url}`;
          }
        } else {
          dataToUpload.content = `Page: ${tab?.title || ''}\nURL: ${tab?.url || ''}`;
        }
      } catch (e) {
        console.warn('[ContextMenu] robustExtractPage failed:', e);
        dataToUpload.content = `Page: ${tab?.title || ''}\nURL: ${tab?.url || ''}`;
      }
    }
    
    dataToUpload.metadata = {
      pageUrl: info.pageUrl,
      tabTitle: tab?.title,
      context: 'context_menu'
    };
    
    uploadToAer(dataToUpload)
      .then(result => console.log('[Background] Context menu upload successful'))
      .catch(error => console.error('[Background] Context menu upload failed:', error));
  }

  if (info.menuItemId === 'uploadSummaryToAer') {
    // Build plaintext from selection or full page, then upload summary-only (client-encrypted)
    try {
      let plain = '';
      if (info.selectionText && info.selectionText.trim().length > 0) {
        plain = info.selectionText.trim();
      } else if (tab?.id) {
        try {
          const page = await robustExtractPage(tab.id);
          if (page && page.content) {
            plain = `Title: ${page.title}\nURL: ${page.url}\n\n${page.content}`;
          } else {
            plain = `Page: ${tab.title || ''}\nURL: ${tab.url || ''}`;
          }
        } catch (e) {
          plain = `Page: ${tab?.title || ''}\nURL: ${tab?.url || ''}`;
        }
      }

      const payload = {
        plaintext: plain,
        summaryOnly: true,
        metadata: {
          pageUrl: info.pageUrl || tab?.url,
          tabTitle: tab?.title,
          context: 'context_menu_summary'
        }
      };

      const result = await uploadToAer(payload);
      console.log('[Background] Summary upload successful', result);
    } catch (e) {
      console.error('[Background] Summary upload failed:', e);
    }
  }

  if (info.menuItemId === 'findFromAer') {
    try {
      if (!tab?.id || !tab?.url || isRestrictedUrl(tab.url)) {
        chrome.notifications.create({
          type: 'basic', iconUrl: chrome.runtime.getURL('icon128.png'),
          title: 'Aer Assist', message: 'Cannot run on this page.'
        });
        return;
      }

      // Ensure content scripts are present
      await ensureAssistScripts(tab.id, tab.url);

      // Determine query from selection or active input
      let query = info.selectionText || '';
      if ((!query || query.trim().length === 0) && tab?.id) {
        try {
          const resp = await chrome.tabs.sendMessage(tab.id, { action: 'getActiveInputValue' });
          if (resp && typeof resp.value === 'string') {
            query = resp.value;
          }
        } catch (e) {
          console.warn('[FindFromAer] Could not read active input value:', e);
        }
      }
      query = (query || '').toString().slice(0, 500);

      // Get auth + api base
      const storage = await chrome.storage.local.get(['authToken', 'token', 'apiUrl', 'apiBaseUrl']);
      const authToken = storage.authToken || storage.token || API_TOKEN;
      if (!authToken) {
        chrome.notifications.create({
          type: 'basic', iconUrl: chrome.runtime.getURL('icon128.png'),
          title: 'Aer Assist', message: 'Please configure your Aer token first.'
        });
        return;
      }
      const apiBase = storage.apiUrl || storage.apiBaseUrl || DEFAULT_API_BASE;

      // Extract userId from token format aer_{userId}
      const userId = authToken.startsWith('aer_') ? authToken.substring(4) : '';

      // Semantic search + client-side ranking
      const { results } = await semanticSearch(query, authToken, apiBase, 30);
      const ranked = rankByRelevance(query, results).slice(0, 15);

      // Ensure scripts before showing popup
      await ensureAssistScripts(tab.id, tab.url);
      // Send results to content script to render popup
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'showAssistPopup',
          results: ranked,
          userId,
          query,
        });
      }
    } catch (e) {
      console.error('[FindFromAer] Error:', e);
      chrome.notifications.create({
        type: 'basic', iconUrl: chrome.runtime.getURL('icon128.png'),
        title: 'Aer Assist', message: `Search failed: ${e?.message || e}`
      });
    }
  }
});

// ============================================
// TAB MANAGEMENT
// ============================================
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    tabStates.set(tabId, {
      url: tab.url,
      title: tab.title,
      lastUpdated: Date.now()
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
});

// ============================================
// UTILITY FUNCTIONS
// ============================================

// Simple encryption placeholder - implement your own
async function encryptContent(data) {
  try {
    return btoa(typeof data === 'string' ? data : JSON.stringify(data));
  } catch (error) {
    console.error('[Encrypt] Error:', error);
    return data;
  }
}

// Test function to verify the upload is working
async function testUpload() {
  console.log('=== Testing Upload Function ===');
  
  const testCases = [
    'Simple string',
    { text: 'Object with text field' },
    { message: 'Object with message field' },
    { data: 'Object with data field' },
    { content: 'Object with correct content field' },
    { random: 'Object with unrecognized field' }
  ];
  
  for (const testData of testCases) {
    try {
      console.log('Testing:', testData);
      const prepared = prepareDataForUpload(testData);
      console.log('Prepared:', prepared);
      // Uncomment to actually test upload:
      // await uploadToAer(testData);
    } catch (error) {
      console.error('Test failed:', error);
    }
  }
}

// ============================================
// STARTUP
// ============================================
console.log('[Background] Background script loaded');
console.log('[Background] API Endpoint:', AER_API_ENDPOINT);

// Uncomment to run tests on load:
// testUpload();
