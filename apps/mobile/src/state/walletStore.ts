import { useSyncExternalStore } from "react";

type WalletState = {
  address: string;
  setWallet: (address: string) => void;
};

type WalletStoreHook = {
  <T>(selector: (state: WalletState) => T): T;
  getState: () => WalletState;
  setWallet: (address: string) => void;
};

const listeners = new Set<() => void>();
let state: WalletState;

function setWallet(address: string) {
  state = { ...state, address };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

state = { address: "", setWallet };

export const useWalletStore: WalletStoreHook = ((
  selector: (state: WalletState) => unknown
) => {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state)
  );
}) as WalletStoreHook;

useWalletStore.getState = () => state;
useWalletStore.setWallet = setWallet;
