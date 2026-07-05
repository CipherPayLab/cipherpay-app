import React, { useState, useEffect, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Check, CheckCircle2, ChevronDown, Grid2x2, Loader2 } from 'lucide-react';

function WalletSelector({ onWalletConnected, onWalletDisconnected }) {
  const { publicKey, connected, disconnect, wallet, wallets, select, connecting, connect } = useWallet();
  const [showWalletList, setShowWalletList] = useState(false);
  const prevConnectedRef = useRef(false); // Track previous connection state

  const uniqueWallets = wallets.reduce((unique, w) => {
    if (!unique.find((u) => u.adapter.name === w.adapter.name)) {
      unique.push(w);
    }
    return unique;
  }, []);

  // The wallet shown in the "Selected wallet" slot: whatever is actively
  // selected, falling back to the first (highest-priority) detected wallet.
  const preferredWallet = wallet || uniqueWallets[0];

  useEffect(() => {
    // Only call onWalletConnected when connection changes from false to true
    // This prevents auto-authentication when user navigates to login with already-connected wallet
    if (connected && publicKey && onWalletConnected && !prevConnectedRef.current) {
      onWalletConnected(publicKey.toBase58());
    }
    // Update the previous connection state
    prevConnectedRef.current = connected;
  }, [connected, publicKey, onWalletConnected]);

  useEffect(() => {
    if (!connected) {
      // Reset the previous connection ref when disconnected
      // This ensures the UI updates correctly and allows reconnection detection
      prevConnectedRef.current = false;
      if (onWalletDisconnected) {
        onWalletDisconnected();
      }
    }
  }, [connected, onWalletDisconnected]);

  const handleWalletSelect = async (walletName) => {
    try {
      await select(walletName);
      setShowWalletList(false);
    } catch (error) {
      console.error('Error selecting wallet:', error);
    }
  };

  const handleConnect = async () => {
    try {
      if (preferredWallet?.adapter && !connected) {
        if (wallet?.adapter?.name !== preferredWallet.adapter.name) {
          await select(preferredWallet.adapter.name);
        }
        await connect();
      }
    } catch (error) {
      console.error('Error connecting wallet:', error);
      if (error.name !== 'WalletConnectionUserCancelledError') {
        // Only log errors that aren't user cancellations
        alert(`Connection failed: ${error.message}`);
      }
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
      if (onWalletDisconnected) {
        onWalletDisconnected();
      }
    } catch (error) {
      console.error('Error disconnecting wallet:', error);
    }
  };

  // If wallet is connected, show connected state
  if (connected && publicKey) {
    return (
      <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-green-500/20">
              <Check className="h-5 w-5 text-green-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-green-300">
                {wallet?.adapter?.name || 'Wallet'} Connected
              </p>
              <p className="truncate font-mono text-xs text-green-400/70">
                {publicKey.toBase58().slice(0, 8)}...{publicKey.toBase58().slice(-8)}
              </p>
            </div>
          </div>
          <button
            onClick={handleDisconnect}
            className="flex-shrink-0 rounded-md border border-green-500/30 px-3 py-1 text-sm font-medium text-green-300 transition-colors hover:bg-green-500/20"
          >
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  if (uniqueWallets.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
        <p className="text-sm text-gray-400">
          No wallets detected. Please install a Solana wallet extension like Phantom or Solflare.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-400">Selected wallet</h3>
        <button
          type="button"
          onClick={() => setShowWalletList((v) => !v)}
          className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left transition-colors hover:border-white/20"
        >
          <div className="flex min-w-0 items-center gap-3">
            {preferredWallet?.adapter?.icon && (
              <img
                src={preferredWallet.adapter.icon}
                alt={preferredWallet.adapter.name}
                className="h-8 w-8 flex-shrink-0 rounded-full"
              />
            )}
            <span className="truncate text-sm font-medium text-white">
              {preferredWallet?.adapter?.name}
            </span>
            {preferredWallet?.adapter?.name?.toLowerCase().includes('phantom') && (
              <span className="flex-shrink-0 rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-400">
                Recommended
              </span>
            )}
          </div>
          <ChevronDown
            className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${showWalletList ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      <button
        onClick={handleConnect}
        disabled={connecting}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {connecting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Connecting...
          </>
        ) : (
          <>
            {preferredWallet?.adapter?.icon && (
              <img src={preferredWallet.adapter.icon} alt="" className="h-5 w-5 rounded-full" />
            )}
            Connect {preferredWallet?.adapter?.name}
          </>
        )}
      </button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-white/10" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-[#0d1220] px-2 text-gray-500">or choose from list</span>
        </div>
      </div>

      {showWalletList ? (
        <div className="space-y-2">
          {uniqueWallets.map((walletOption) => {
            const isInstalled = walletOption.readyState === 'Installed' || walletOption.readyState === 'Loadable';
            const isSelected = preferredWallet?.adapter?.name === walletOption.adapter.name;

            let statusText = 'Not detected';
            let statusColor = 'text-gray-500';

            if (walletOption.readyState === 'Installed') {
              statusText = 'Installed';
              statusColor = 'text-green-400';
            } else if (walletOption.readyState === 'Loadable') {
              statusText = 'Available';
              statusColor = 'text-blue-400';
            }

            return (
              <button
                key={walletOption.adapter.name}
                onClick={() => handleWalletSelect(walletOption.adapter.name)}
                disabled={connecting || !isInstalled}
                className={`flex w-full items-center justify-between rounded-xl border p-3 transition-colors ${
                  isSelected
                    ? 'border-blue-500/50 bg-blue-500/10'
                    : isInstalled
                    ? 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                    : 'border-white/5 bg-white/[0.02] opacity-50'
                }`}
              >
                <div className="flex flex-1 items-center gap-3">
                  {walletOption.adapter.icon && (
                    <img
                      src={walletOption.adapter.icon}
                      alt={walletOption.adapter.name}
                      className="h-8 w-8 flex-shrink-0 rounded-full"
                    />
                  )}
                  <div className="min-w-0 text-left">
                    <p className="text-sm font-medium text-white">{walletOption.adapter.name}</p>
                    <p className={`text-xs font-medium ${statusColor}`}>{statusText}</p>
                  </div>
                </div>
                {isSelected && (
                  <CheckCircle2 className="ml-2 h-5 w-5 flex-shrink-0 text-blue-400" />
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <button
          onClick={() => setShowWalletList(true)}
          className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-gray-300 transition-colors hover:border-white/20 hover:bg-white/10"
        >
          <span className="flex items-center gap-2">
            <Grid2x2 className="h-4 w-4" />
            Show all wallets
          </span>
          <ChevronDown className="h-4 w-4 -rotate-90" />
        </button>
      )}
    </div>
  );
}

export default WalletSelector;
