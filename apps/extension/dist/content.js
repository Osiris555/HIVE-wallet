"use strict";
(() => {
  // src/content.ts
  (function() {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("inpage.js");
    script.type = "text/javascript";
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
    const origin = window.location.origin;
    const title = document.title || origin;
    const tabId = -1;
    window.addEventListener("hive_inpage_request", (e) => {
      const event = e;
      const { method, params, requestId } = event.detail;
      chrome.runtime.sendMessage(
        {
          type: "inpage_request",
          method,
          params,
          requestId,
          origin,
          title,
          tabId
        },
        (response) => {
          window.dispatchEvent(
            new CustomEvent("hive_inpage_response", { detail: { requestId, response } })
          );
        }
      );
    });
    chrome.runtime.onMessage.addListener((msg) => {
      const m = msg;
      if (m.type === "hive_response") {
        window.dispatchEvent(
          new CustomEvent("hive_inpage_response", {
            detail: { requestId: m.requestId, response: m.error ? { error: m.error } : { result: m.result } }
          })
        );
      }
      if (m.type === "hive_popup_required") {
        window.dispatchEvent(new Event("hive_popup_required"));
      }
    });
  })();
})();
