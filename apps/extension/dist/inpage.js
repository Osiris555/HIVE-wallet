"use strict";
(() => {
  // src/inpage.ts
  (function() {
    if (window["hive"]) return;
    let reqCounter = 0;
    const pending = /* @__PURE__ */ new Map();
    window.addEventListener("hive_inpage_response", (e) => {
      const event = e;
      const { requestId, response } = event.detail;
      const p = pending.get(requestId);
      if (!p) return;
      if (response.pending) {
        return;
      }
      pending.delete(requestId);
      if (response.error) {
        p.reject(new Error(response.error));
      } else {
        p.resolve(response.result);
      }
    });
    function request(method, params) {
      return new Promise((resolve, reject) => {
        const requestId = String(++reqCounter);
        pending.set(requestId, { resolve, reject });
        window.dispatchEvent(
          new CustomEvent("hive_inpage_request", { detail: { method, params, requestId } })
        );
      });
    }
    const listeners = {};
    function on(event, cb) {
      (listeners[event] ??= []).push(cb);
    }
    function removeListener(event, cb) {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((f) => f !== cb);
      }
    }
    function emit(event, data) {
      (listeners[event] ?? []).forEach((cb) => cb(data));
    }
    const provider = {
      isHive: true,
      /** Returns currently connected accounts ([] if not connected). */
      accounts() {
        return request("hive_accounts");
      },
      /** Prompts the user to connect. Returns [address] on approval. */
      requestAccounts() {
        return request("hive_requestAccounts");
      },
      /** Returns the Honey Network chain id ('0x01'). */
      chainId() {
        return request("hive_chainId");
      },
      /**
       * Sign an arbitrary message with ML-DSA-65.
       * Returns { signature: hexString, address: string }.
       */
      sign(message) {
        return request("hive_sign", [message]);
      },
      /** Returns HNY balance of connected address as a string. */
      getBalance() {
        return request("hive_getBalance");
      },
      /**
       * Request user authorization for a transaction.
       * Opens the extension popup with Chrysalis ceremony.
       * Returns { txId, success } on approval, rejects on cancel.
       */
      requestTransaction(txData) {
        return request("hive_requestTx", [txData]);
      },
      on,
      removeListener,
      _emit: emit
      // internal — used by content script to surface events
    };
    window["hive"] = provider;
    window.dispatchEvent(new Event("hive#initialized"));
  })();
})();
