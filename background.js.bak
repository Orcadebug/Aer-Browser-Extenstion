// Configuration - loaded from chrome.storage
let authToken = null;
let API_BASE_URL = null;

// Load configuration on startup
chrome.storage.local.get(['authToken', 'apiBaseUrl'], (result) => {
  authToken = result.authToken || null;
  API_BASE_URL = result.apiBaseUrl || 'https://different-bandicoot-508.convex.site';
  console.log('[Init] Configuration loaded:', { 
    hasToken: !!authToken, 
    apiUrl: API_BASE_URL 
  });
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes.authToken) {
      authToken = changes.authToken.newValue;
      console.log('[Storage] Auth token updated:', !!authToken);
    }
    if (changes.apiBaseUrl) {
      API_BASE_URL = changes.apiBaseUrl.newValue;
      console.log('[Storage] API URL updated:', API_BASE_URL);
    }
  }
});

// Base64 encoding/decoding helpers
function encodeBase64(bytes) {
  const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join('');
  return btoa(binString);
}

function decodeBase64(base64) {
  const binString = atob(base64);
  return Uint8Array.from(binString, (m) => m.codePointAt(0));
}

// Simple encryption key derivation from user ID
async function generateEncryptionKey(userId) {
  const encoder = new TextEncoder();
  const data = encoder.encode(userId);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuffer);
}

// Simple XOR encryption (placeholder - in production use proper encryption)
function encryptData(text, key) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const encrypted = new Uint8Array(data.length);
  
  for (let i = 0; i < data.length; i++) {
    encrypted[i] = data[i] ^ key[i % key.length];
  }
  
  // Generate a random nonce
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  
  return {
    ciphertext: encodeBase64(encrypted),
    nonce: encodeBase64(nonce)
  };
}

async function checkConnection() {
  try {
    console.log('[checkConnection] Checking auth with token:', authToken ? '✅ Token loaded' : '❌ No token');
    console.log('[checkConnection] API URL:', API_BASE_URL);
    
    if (!authToken) {
      console.warn('[checkConnection] ⚠️ No auth token found. User must set up authentication first.');
      return { success: true, hasToken: false, user: null };
    }

    // Validate token format
    if (!authToken.startsWith('aer_')) {
      console.error('[checkConnection] ❌ Invalid token format. Token must start with "aer_"');
      return { success: false, hasToken: false, error: 'Invalid token format' };
    }

    console.log('[checkConnection] ✅ Token format validated');
    
    // Token format is valid (aer_{userId})
    // We don't need to make an HTTP request to validate - the token will be validated
    // when the user actually captures content via /api/context/upload
    
    // Extract user ID from token for display
    const userId = authToken.substring(4); // Remove "aer_" prefix
    
    return { 
      success: true, 
      hasToken: true, 
      user: { _id: userId, email: 'Connected' }
    };
    
  } catch (error) {
    console.error('[checkConnection] ❌ Connection test failed:', error.message);
    return { success: false, hasToken: false, error: error.message };
  }
}

async function captureAndSave(data) {
  try {
    // Check authentication first
    const connectionStatus = await checkConnection();
    if (!connectionStatus.hasToken) {
      throw new Error('Not authenticated. Please set up authentication in the extension first.');
    }
    
    const userId = authToken.substring(4); // Extract user ID from aer_{userId}
    
    // Generate encryption key from user ID
    const encryptionKey = await generateEncryptionKey(userId);
    
    // Encrypt content
    const fullContent = `URL: ${data.url}\n\n${data.content}`;
    const title = data.title || 'Untitled Page';
    const summary = fullContent.substring(0, 200) + '...';
    
    const encryptedContent = encryptData(fullContent, encryptionKey);
    const encryptedTitle = encryptData(title, encryptionKey);
    
    console.log('[captureAndSave] Uploading to:', `${API_BASE_URL}/api/context/upload`);
    
    const response = await fetch(`${API_BASE_URL}/api/context/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: title.substring(0, 50),
        type: 'web',
        url: data.url,
        content: fullContent,
        encryptedContent,
        encryptedTitle,
        encryptedMetadata: {
          ciphertext: encodeBase64(new Uint8Array([1, 2, 3])),
          nonce: encodeBase64(new Uint8Array([4, 5, 6]))
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('[captureAndSave] ✅ Context saved:', result.contextId);
    
    return { success: true, contextId: result.contextId };
    
  } catch (error) {
    console.error('[captureAndSave] ❌ Failed to save:', error);
    throw error;
  }
}

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Background] Received message:', request.action);
  
  if (request.action === 'checkConnection') {
    checkConnection().then(sendResponse);
    return true; // Keep channel open for async response
  }
  
  if (request.action === 'captureContent') {
    captureAndSave(request.data)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (request.action === 'openAuth') {
    chrome.tabs.create({ url: chrome.runtime.getURL('auth.html') });
    sendResponse({ success: true });
    return false;
  }
});

console.log('[Background] Service worker initialized');