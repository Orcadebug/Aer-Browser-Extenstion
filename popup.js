let isConnected = false;

// Check connection status on popup load
document.addEventListener('DOMContentLoaded', async () => {
  await checkConnection();
  
  // Setup event listeners
  document.getElementById('captureBtn').addEventListener('click', captureCurrentPage);
  document.getElementById('setupBtn').addEventListener('click', openAuthPage);
});

async function checkConnection() {
  const statusIndicator = document.getElementById('statusIndicator');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const captureBtn = document.getElementById('captureBtn');
  const setupBtn = document.getElementById('setupBtn');
  const userInfo = document.getElementById('userInfo');
  
  try {
    const response = await chrome.runtime.sendMessage({ action: 'checkConnection' });
    
    if (response.success && response.hasToken) {
      // Connected
      isConnected = true;
      
      statusDot.classList.add('connected');
      statusText.textContent = 'Connected';
      
      captureBtn.disabled = false;
      setupBtn.style.display = 'none';
      userInfo.style.display = 'block';
    } else {
      // Not connected
      isConnected = false;
      
      statusDot.classList.remove('connected');
      statusText.textContent = 'Not Connected';
      
      captureBtn.disabled = true;
      setupBtn.style.display = 'block';
      userInfo.style.display = 'none';
      
      showError('Please setup authentication first.');
    }
  } catch (error) {
    console.error('Connection check failed:', error);
    
    isConnected = false;
    statusDot.classList.remove('connected');
    statusText.textContent = 'Error';
    
    captureBtn.disabled = true;
    setupBtn.style.display = 'block';
    userInfo.style.display = 'none';
    
    showError('Connection error. Please setup authentication.');
  }
}

async function captureCurrentPage() {
  if (!isConnected) {
    showError('Please setup authentication first.');
    return;
  }
  
  const captureBtn = document.getElementById('captureBtn');
  captureBtn.disabled = true;
  captureBtn.textContent = 'Capturing...';
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    const response = await chrome.runtime.sendMessage({
      action: 'capture',
      url: tab.url,
      title: tab.title
    });
    
    if (response.success) {
      showSuccess('Page captured successfully!');
      setTimeout(() => window.close(), 1500);
    } else {
      showError(response.error || 'Failed to capture page');
    }
  } catch (error) {
    console.error('Capture failed:', error);
    showError('Failed to capture page. Please try again.');
  } finally {
    captureBtn.disabled = false;
    captureBtn.textContent = 'Capture This Page';
  }
}

function openAuthPage() {
  chrome.runtime.sendMessage({ action: 'openAuth' });
}

function showError(message) {
  const errorMsg = document.getElementById('errorMsg');
  const successMsg = document.getElementById('successMsg');
  
  successMsg.classList.remove('show');
  errorMsg.textContent = message;
  errorMsg.classList.add('show');
  
  setTimeout(() => {
    errorMsg.classList.remove('show');
  }, 5000);
}

function showSuccess(message) {
  const errorMsg = document.getElementById('errorMsg');
  const successMsg = document.getElementById('successMsg');
  
  errorMsg.classList.remove('show');
  successMsg.textContent = message;
  successMsg.classList.add('show');
  
  setTimeout(() => {
    successMsg.classList.remove('show');
  }, 3000);
}
