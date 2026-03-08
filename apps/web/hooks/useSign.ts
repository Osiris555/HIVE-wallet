'use client';
// useSign — universal signing hook for honey.trade web pages.
//
// For platform (auth) users: calls POST /auth/sign-tx (server-side ML-DSA-65).
//   → Shows ChrysalisSignModal stages automatically.
// For extension users: calls window.hive.sign(message).
//   → Extension popup opens; returns signature.
//
// Usage:
//   const { sign, sigModal } = useSign();
//   const result = await sign('my|message|here');
//   // render sigModal somewhere in the JSX

import { useState, useCallback } from 'react';
import { useHiveWallet } from '@/components/HiveWalletConnect';
import ChrysalisSignModal from '@/components/ChrysalisSignModal';
import React from 'react';

const API_BASE = process.env.NEXT_PUBLIC_HIVE_API || 'http://localhost:3000';

export type SignResult = {
  signatureHex: string;
  mldsaPubKeyHex: string;
  wallet: string;
};

type Stage = 'idle' | 'init' | 'keys' | 'attest' | 'sign' | 'done' | 'error';

type SignModalState = {
  visible: boolean;
  title: string;
  description: string;
  stage: Stage;
  error?: string;
};

export function useSign() {
  const { authUser, isAuthUser, address } = useHiveWallet();

  const [modal, setModal] = useState<SignModalState>({
    visible: false, title: '', description: '', stage: 'idle',
  });

  const closeModal = useCallback(() => {
    setModal(m => ({ ...m, visible: false, stage: 'idle', error: undefined }));
  }, []);

  /**
   * Sign a message. Works for both platform auth users and extension users.
   * @param message — the raw string to sign
   * @param opts.title — modal title shown to auth users (default: "Authorise Transaction")
   * @param opts.description — human-readable action description
   * @returns SignResult with signatureHex, mldsaPubKeyHex, wallet
   */
  const sign = useCallback(async (
    message: string,
    opts?: { title?: string; description?: string },
  ): Promise<SignResult> => {
    const title       = opts?.title       ?? 'Authorise Transaction';
    const description = opts?.description ?? message.slice(0, 100);

    if (isAuthUser && authUser?.token) {
      // ── Platform auth: server-side signing with Chrysalis ceremony ──────────
      setModal({ visible: true, title, description, stage: 'init' });

      await delay(350);
      setModal(m => ({ ...m, stage: 'keys' }));

      await delay(400);
      setModal(m => ({ ...m, stage: 'attest' }));

      await delay(350);
      setModal(m => ({ ...m, stage: 'sign' }));

      try {
        const resp = await fetch(`${API_BASE}/auth/sign-tx`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authUser.token}`,
          },
          body: JSON.stringify({ message }),
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
          setModal(m => ({ ...m, stage: 'error', error: err.error ?? 'Signing failed' }));
          throw new Error(err.error ?? 'Signing failed');
        }

        const data = await resp.json() as { signatureHex: string; mldsaPubKeyHex: string; wallet: string };
        setModal(m => ({ ...m, stage: 'done' }));

        return {
          signatureHex:   data.signatureHex,
          mldsaPubKeyHex: data.mldsaPubKeyHex,
          wallet:         data.wallet ?? address ?? '',
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setModal(m => ({ ...m, stage: 'error', error: msg }));
        throw e;
      }
    } else {
      // ── Extension user: delegate to window.hive.sign ─────────────────────
      type HiveWin = {
        hive?: {
          isHive?: boolean;
          sign?: (msg: string) => Promise<{ signature: string; address: string; publicKeyHex?: string }>;
        };
      };
      const hiveExt = (window as unknown as HiveWin).hive;
      if (!hiveExt?.sign) {
        throw new Error('HIVE Wallet extension is not installed or connected.');
      }
      const result = await hiveExt.sign(message);
      return {
        signatureHex:   result.signature,
        mldsaPubKeyHex: result.publicKeyHex ?? '',
        wallet:         result.address ?? address ?? '',
      };
    }
  }, [isAuthUser, authUser, address]);

  // The modal element to render in JSX
  const sigModal = React.createElement(ChrysalisSignModal, {
    key: 'chrysalis-sign-modal',
    visible:     modal.visible,
    title:       modal.title,
    description: modal.description,
    stage:       modal.stage,
    error:       modal.error,
    onClose:     closeModal,
  });

  return { sign, sigModal, isSigning: modal.visible && modal.stage !== 'done' && modal.stage !== 'error' };
}

function delay(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}
