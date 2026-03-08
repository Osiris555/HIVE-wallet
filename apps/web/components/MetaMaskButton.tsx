'use client';

import { useConnect, useAccount, useDisconnect } from 'wagmi';
import { injected } from 'wagmi/connectors';

export default function MetaMaskButton() {
  const { connect } = useConnect();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  const truncate = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

  if (isConnected && address) {
    return (
      <span
        className="font-mono-hive text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5 cursor-pointer"
        style={{ background: 'var(--glass2)', border: '1px solid var(--border2)', color: 'var(--blue)' }}
        onClick={() => disconnect()}
        title="Click to disconnect MetaMask"
      >
        <span className="w-2 h-2 rounded-full bg-[var(--blue)] inline-block" />
        {truncate(address)}
      </span>
    );
  }

  return (
    <button
      className="btn-outline text-sm"
      onClick={() => connect({ connector: injected() })}
    >
      🦊 MetaMask
    </button>
  );
}
