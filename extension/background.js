/* Local capture support only. No account integration or analytics. */
importScripts('font-downloads.js');
chrome.action.onClicked.addListener(openCapturePanel);

async function openCapturePanel(tab) {
  try {
    if (!tab?.id || !/^(https?|file):/.test(tab.url || '')) throw new Error('Откройте обычную веб-страницу.');
    if (tab.url.startsWith('file:') && !await chrome.extension.isAllowedFileSchemeAccess()) {
      throw new Error('В настройках расширения включите доступ к файлам.');
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] });
    await chrome.action.setBadgeText({ tabId: tab.id, text: '' });
    await chrome.action.setTitle({ tabId: tab.id, title: 'Clean Capture' });
  } catch (error) {
    console.warn('[Clean Capture]', error);
    if (tab?.id) {
      await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
      await chrome.action.setTitle({ tabId: tab.id, title: error.message });
    }
  }
}

chrome.runtime.onMessage.addListener((request, sender, reply) => {
  handle(request, sender).then(value => reply({ success: true, value }),
    error => reply({ success: false, error: { message: error.message } }));
  return true;
});

async function handle(request, sender) {
  switch (request.cmd) {
    case 'H2D_DOWNLOAD_FONTS': return downloadCaptureFonts(request.payload);
    case 'H2D_GET_TAB_ID': return sender.tab?.id ?? null;
    case 'H2D_TOOLBAR_CLOSED': return null;
    case 'H2D_CAPTURE_VISIBLE_TAB':
    case 'H2D_CAPTURE_ELEMENT_PREVIEW':
      // Preview thumbnails are optional; avoiding captureVisibleTab keeps this
      // experiment scoped to DOM capture with activeTab permission.
      return '';
    case 'H2D_FETCH_ASSETS': return Promise.all((request.payload?.urls || []).map(fetchAsset));
    default: throw new Error(`Unsupported local command: ${request.cmd}`);
  }
}

async function fetchAsset(raw) {
  const failed = { url: raw, blob: null, error: 'recovery_failed' };
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return failed;
    // Recovery only works after the user explicitly grants image access.
    if (!await chrome.permissions.contains({ origins: [`${url.origin}/*`] })) return failed;
    const response = await fetch(url.href, {
      credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(5000), cache: 'force-cache',
    });
    const type = response.headers.get('content-type') || '';
    if (!response.ok || !type.startsWith('image/')) { await response.body?.cancel(); return failed; }
    const limit = 10 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); return failed; }
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); return failed; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { url: raw, blob: { type: type.split(';')[0], base64Blob: `data:${type.split(';')[0]};base64,${btoa(binary)}` } };
  } catch { return failed; }
}

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.local.remove([`clean_capture_toolbar_captures_${tabId}`, `clean_capture_toolbar_open_${tabId}`]);
});
