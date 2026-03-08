// HIVE Wallet — Content Script
// Injects inpage.js into the page and bridges postMessage ↔ chrome.runtime.

(function () {
  // Inject the inpage provider script into the page's main world
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('inpage.js');
  script.type = 'text/javascript';
  (document.head || document.documentElement).appendChild(script);
  script.onload = () => script.remove();

  const origin = window.location.origin;
  const title  = document.title || origin;
  const tabId  = -1; // will be resolved by background from sender.tab.id

  // ── inpage → background relay ─────────────────────────────
  window.addEventListener('hive_inpage_request', (e) => {
    const event = e as CustomEvent<{ method: string; params?: unknown[]; requestId: string }>;
    const { method, params, requestId } = event.detail;

    chrome.runtime.sendMessage(
      {
        type: 'inpage_request',
        method,
        params,
        requestId,
        origin,
        title,
        tabId,
      },
      (response: unknown) => {
        // Relay response back to inpage
        window.dispatchEvent(
          new CustomEvent('hive_inpage_response', { detail: { requestId, response } }),
        );
      },
    );
  });

  // ── background → inpage relay (async tab messages) ────────
  chrome.runtime.onMessage.addListener((msg: unknown) => {
    const m = msg as { type: string; requestId?: string; result?: unknown; error?: string };
    if (m.type === 'hive_response') {
      window.dispatchEvent(
        new CustomEvent('hive_inpage_response', {
          detail: { requestId: m.requestId, response: m.error ? { error: m.error } : { result: m.result } },
        }),
      );
    }
    // Background could not open popup automatically — tell the page to prompt the user
    if (m.type === 'hive_popup_required') {
      window.dispatchEvent(new Event('hive_popup_required'));
    }
  });
})();
