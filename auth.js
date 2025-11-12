/**
 * Aer Chrome Extension - Auth Page Script
 * - Loads/saves API URL and auth token
 * - Defaults API URL to https://honorable-porpoise-222.convex.site
 * - Saves to chrome.storage.local using keys: apiUrl, authToken
 */

const DEFAULT_API_URL = 'https://honorable-porpoise-222.convex.site';

// Helpers to load from storage with backward compatibility
async function getApiUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['apiUrl', 'apiBaseUrl'], (result) => {
      const url = result.apiUrl || result.apiBaseUrl || DEFAULT_API_URL;
      resolve(url);
    });
  });
}

async function getAuthToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['authToken', 'token'], (result) => {
      const token = result.authToken || result.token || '';
      resolve(token);
    });
  });
}

async function saveSettings(apiUrl, authToken) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ apiUrl: apiUrl || DEFAULT_API_URL, authToken: authToken || '' }, () => {
      resolve(true);
    });
  });
}

function setStatus(message, type = 'info') {
  const el = document.getElementById('statusText');
  if (!el) return;
  el.textContent = message;
  el.className = '';
  el.classList.add(type === 'error' ? 'text-red-600' : type === 'success' ? 'text-green-600' : 'text-gray-600');
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const apiUrlInput = document.getElementById('apiUrlInput');
    const tokenInput = document.getElementById('tokenInput');
    const saveBtn = document.getElementById('saveBtn');

    // Populate existing values
    const [apiUrl, authToken] = await Promise.all([getApiUrl(), getAuthToken()]);
    if (apiUrlInput) apiUrlInput.value = apiUrl || DEFAULT_API_URL;
    if (tokenInput) tokenInput.value = authToken || '';

    setStatus('Ready to save your settings.');

    if (saveBtn) {
      saveBtn.addEventListener('click', async (e) => {
        e.preventDefault();

        const newApiUrl = apiUrlInput?.value?.trim() || DEFAULT_API_URL;
        const newToken = tokenInput?.value?.trim() || '';

        if (!newToken) {
          setStatus('Please enter your token (format: aer_{userId}).', 'error');
          return;
        }

        if (!newApiUrl.startsWith('http')) {
          setStatus('API URL must start with http or https.', 'error');
          return;
        }

        try {
          await saveSettings(newApiUrl, newToken);
          setStatus('Settings saved successfully!', 'success');

          // Notify background of new settings (optional)
          chrome.runtime.sendMessage(
            { action: 'saveSettings', apiUrl: newApiUrl, authToken: newToken },
            () => {}
          );

          // Close page after a short delay
          setTimeout(() => window.close(), 800);
        } catch (err) {
          console.error('[Auth] Save error:', err);
          setStatus('Failed to save settings. Check console for details.', 'error');
        }
      });
    }
  } catch (err) {
    console.error('[Auth] Init error:', err);
    setStatus('Initialization error. Please refresh this page.', 'error');
  }
});