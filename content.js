// Content script to extract page content
(function() {
  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'ping') {
      sendResponse({ ok: true, hasContent: true });
      return true;
    }
    if (request.action === "extractContent") {
      const full = !!request.full;
      const maxLen = typeof request.maxLen === 'number' ? request.maxLen : undefined;
      const content = extractMainContent({ full, maxLen });
      sendResponse({
        title: document.title,
        url: window.location.href,
        content,
      });
      return true;
    }
    return true;
  });

  function extractMainContent(opts = {}) {
    const MAX = typeof opts.maxLen === 'number' ? opts.maxLen : 20000;
    try {
      // 1) If user has a selection, prefer it
      const sel = window.getSelection && window.getSelection();
      const selected = sel && typeof sel.toString === 'function' ? (sel.toString() || '').trim() : '';
      if (selected && selected.length > 40) {
        return cleanText(selected).slice(0, MAX);
      }

      // 2) Expand common "show more" / "expand" controls within main
      tryExpanders();

      // 2.5) Autoscroll to load virtualized content (fire-and-continue)
      try { autoScrollMain(800, 4).catch(() => {}); } catch {}

      // 3) Site-aware extraction for LLM UIs
      const host = (location.hostname || '').toLowerCase();
      if (/chatgpt|openai\.com/.test(host)) {
        const t = extractChatGPT();
        if (t && t.length > 0) return t.slice(0, MAX);
      }
      if (/perplexity\.ai/.test(host)) {
        const t = extractPerplexity();
        if (t && t.length > 0) return t.slice(0, MAX);
      }
      if (/claude\.ai/.test(host)) {
        const t = extractClaude();
        if (t && t.length > 0) return t.slice(0, MAX);
      }
      if (/gemini\.google\.com|bard\.google\.com|ai\.google\.com\/.+gemini/i.test(host + location.pathname)) {
        const t = extractGemini({ full: !!opts.full, maxLen: MAX });
        if (t && t.length > 0) return t.slice(0, MAX);
      }

      // 4) Generic: prefer role=main
      const main = document.querySelector('main, [role="main"]');
      if (main) {
        const txt = main.innerText || main.textContent || '';
        const cleaned = cleanText(txt);
        if (cleaned && cleaned.length > 0) return cleaned.slice(0, MAX);
      }

      // 5) Fallback: whole page text
      const bodyText = (document.body && (document.body.innerText || document.body.textContent)) || '';
      return cleanText(bodyText).slice(0, MAX);
    } catch (e) {
      // Last-resort fallback
      const text = (document.body && (document.body.innerText || document.body.textContent)) || '';
      return (text || '').toString().substring(0, MAX);
    }
  }

  function cleanText(text) {
    if (!text) return '';
    return text
      .replace(/\u00A0/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function tryExpanders() {
    try {
      const container = document.querySelector('main, [role="main"]') || document.body;
      const candidates = Array.from(container.querySelectorAll('button, [role="button"], a'));
      const re = /(show more|read more|expand|see more|view more|continue|load more)/i;
      let clicked = 0;
      for (const el of candidates) {
        if (clicked >= 8) break;
        const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
        const expanded = el.getAttribute('aria-expanded');
        if (re.test(label) || expanded === 'false') {
          try { el.click(); clicked++; } catch {}
        }
      }
    } catch {}
  }

  function autoScrollMain(step=800, repeats=3) {
    const el = document.querySelector('main, [role="main"], .overflow-y-auto, .scrollable');
    if (!el) return;
    let i = 0;
    const tick = () => {
      el.scrollTop = el.scrollHeight;
      i += 1;
      if (i < repeats) setTimeout(tick, 150);
    };
    setTimeout(tick, 0);
  }

  function extractChatGPT() {
    try {
      const nodes = Array.from(document.querySelectorAll('[data-message-author-role]'));
      if (nodes.length === 0) return '';
      const blocks = [];
      for (const n of nodes) {
        const roleRaw = n.getAttribute('data-message-author-role') || '';
        const role = /user/i.test(roleRaw) ? 'User' : 'Assistant';
        const t = (n.innerText || n.textContent || '').trim();
        if (!t) continue;
        blocks.push(`${role}:\n${t}`);
      }
      return cleanText(blocks.join('\n\n'));
    } catch { return ''; }
  }

  function extractPerplexity() {
    try {
      // Prefer chat messages, else main; include common prose containers
      const msgs = Array.from(document.querySelectorAll('[data-testid*="chat-message"], [data-message-author-role], [data-testid="answer"], div[class*="prose"], article'));
      if (msgs.length > 0) {
        const parts = [];
        for (const m of msgs) {
          const base = (m.innerText || m.textContent || '').trim();
          parts.push(base);
          // Capture open shadow roots within message (if any)
          if (m.shadowRoot) {
            parts.push((m.shadowRoot.innerText || m.shadowRoot.textContent || '').trim());
          }
        }
        const filtered = parts.filter(Boolean);
        if (filtered.length > 0) return cleanText(filtered.join('\n\n'));
      }
      // Deep capture for open shadow roots under main
      const main = document.querySelector('main, [role="main"]') || document.body;
      const mainText = (main.innerText || main.textContent || '');
      let shadowText = '';
      main.querySelectorAll('*').forEach((el) => {
        if (el.shadowRoot && (el.shadowRoot.innerText || el.shadowRoot.textContent)) {
          shadowText += '\n' + (el.shadowRoot.innerText || el.shadowRoot.textContent);
        }
      });
      return cleanText((mainText + '\n' + shadowText).trim());
    } catch { return ''; }
  }

  function extractClaude() {
    try {
      const msgs = Array.from(document.querySelectorAll('[data-testid="message-bubble"], [data-testid*="message"], article'));
      if (msgs.length > 0) {
        const parts = msgs.map((m) => (m.innerText || m.textContent || '').trim()).filter(Boolean);
        if (parts.length > 0) return cleanText(parts.join('\n\n'));
      }
      const main = document.querySelector('main, [role="main"]');
      const txt = main ? (main.innerText || main.textContent || '') : '';
      return cleanText(txt);
    } catch { return ''; }
  }

  function extractGemini(opts = {}) {
    try {
      const full = !!opts.full;
      const MAX = typeof opts.maxLen === 'number' ? opts.maxLen : 20000;
      const root = document.querySelector('main, [role="main"]') || document.body;

      const NAV_SIDEBAR_SEL = 'aside, nav, header, footer, [role="navigation"], [role="complementary"], [aria-label*="history" i], [aria-label*="conversations" i], [aria-label*="sidebar" i], [aria-label*="right" i], [aria-label*="extensions" i], [aria-label*="apps" i], [aria-label*="explore" i], [aria-label*="settings" i], [data-testid*="sidebar" i], [data-testid*="right" i], [class*="sidebar" i], [class*="sidepanel" i], [class*="side-panel" i]';

      function isVisible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
      }
      function inCentralColumn(el) {
        const r = el.getBoundingClientRect();
        const centerX = (r.left + r.right) / 2;
        const withinCenterBand = centerX > window.innerWidth * 0.25 && centerX < window.innerWidth * 0.75;
        return r.width > 360 && withinCenterBand;
      }
      function inConvoRootBand(el, root) {
        if (!root) return true;
        const rr = root.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const centerX = (r.left + r.right) / 2;
        const bandLeft = rr.left + rr.width * 0.1;
        const bandRight = rr.right - rr.width * 0.1;
        return r.width > 280 && centerX >= bandLeft && centerX <= bandRight && r.left >= rr.left && r.right <= rr.right;
      }
      function withinConversationArea(el) {
        if (!el) return false;
        // Exclude anything under obvious nav/sidebars
        if (el.closest(NAV_SIDEBAR_SEL)) return false;
        return true;
      }

      // Try to locate the active conversation container (feed/list) first
      const containerCandidates = Array.from(root.querySelectorAll('main [role="feed"], main [role="list"], main [aria-live="polite"], main c-wiz, [role="feed"], [role="list"], [aria-live="polite"]'))
        .filter((el) =>
          withinConversationArea(el)
          && (full ? inCentralColumn(el) : (isVisible(el) && inCentralColumn(el)))
          && !el.closest(NAV_SIDEBAR_SEL)
          && !el.querySelector(NAV_SIDEBAR_SEL)
          && el.querySelectorAll('article, [role="listitem"], div[class*="prose"], [data-message-author-role]').length >= 2
        );

      function scoreContainer(el) {
        const r = el.getBoundingClientRect();
        const areaScore = Math.log(1 + r.width * r.height);
        const msgCount = el.querySelectorAll('article, [role="listitem"], div[class*="prose"], [data-message-author-role]').length;
        return msgCount * 10 + areaScore;
      }

      let convoRoot = null;
      if (containerCandidates.length) {
        convoRoot = containerCandidates.sort((a, b) => scoreContainer(b) - scoreContainer(a))[0];
      }
      // If no clear container found, use root but still exclude nav/sidebars later
      if (!convoRoot) convoRoot = root;

      // Prefer JSON/code blocks from the assistant (Gemini often renders structured JSON in code blocks)
      const jsonBlocks = Array.from(convoRoot.querySelectorAll('pre, code, pre code, div[class*="code"], code[class*="language-json"], [data-language="json"]'))
        .filter((el) => withinConversationArea(el) && inConvoRootBand(el, convoRoot) && (full ? true : isVisible(el)))
        .map((el) => (el.innerText || el.textContent || '').trim())
        .filter((t) => t && /[{\[]/.test(t) && /:\s*"?\w/.test(t));
      if (jsonBlocks.length) {
        // Return the largest JSON-looking block
        const best = jsonBlocks.sort((a, b) => b.length - a.length)[0];
        return cleanText(best).slice(0, MAX);
      }

      // Candidate message nodes within the conversation area only
      const selectors = [
        'article',
        '[role="listitem"]',
        '[aria-live="polite"] *',
        'div[class*="prose"]',
        '[data-message-author-role]'
      ];
      let candidates = [];
      selectors.forEach(sel => candidates.push(...Array.from(convoRoot.querySelectorAll(sel))));

      // Keep nodes that are visible, in center, not within nav/sidebars
      const msgs = candidates
        .filter((n) => withinConversationArea(n) && inConvoRootBand(n, convoRoot) && (full ? true : isVisible(n)))
        .map((n) => (n.innerText || n.textContent || '').trim())
        .filter(Boolean)
        // Deduplicate consecutive identicals
        .filter((t, i, arr) => i === 0 || t !== arr[i - 1]);

      // Limit to last 12 message blocks to reflect the current chat context
      const selected = full ? msgs : msgs.slice(-12);
      if (selected.length > 0) return cleanText(selected.join('\n\n'));

      // Fallback: visible text from central area only, excluding sidebars/nav
      const blocks = Array.from(convoRoot.querySelectorAll('article, [role="listitem"], div[class*="prose"], [data-message-author-role]'))
        .filter((el) => withinConversationArea(el) && inConvoRootBand(el, convoRoot) && (full ? true : isVisible(el)))
        .map((el) => (el.innerText || el.textContent || '').trim())
        .filter(Boolean);
      if (blocks.length > 0) return cleanText(blocks.slice(-20).join('\n\n'));

      // Last resort: convoRoot text (still excludes outside nav due to root selection)
      const txt = (convoRoot.innerText || convoRoot.textContent || '').trim();
      return cleanText(txt);
    } catch { return ''; }
  }
})();
