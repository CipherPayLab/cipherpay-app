import React, { useState, useEffect } from 'react';
import { useCipherPay } from '../contexts/CipherPayContext';
import cipherPayService from '../services';

function SDKStatus() {
    const { isInitialized, sdk } = useCipherPay();
    const [sdkStatus, setSdkStatus] = useState({
        hasRelayerClient: false,
        hasMerkleTreeClient: false,
        hasWalletProvider: false,
        hasNoteManager: false
    });
    const [backendStatus, setBackendStatus] = useState({
        merkleTreeAvailable: false,
        noteManagerAvailable: false,
        checking: true
    });

    useEffect(() => {
        const checkSDKStatus = () => {
            // Check SDK directly from service to ensure we get the latest instance
            const serviceSdk = cipherPayService.sdk || sdk;
            
            if (serviceSdk) {
                let relayerClient = null;
                let merkleTreeClient = null;
                let walletProvider = null;
                let noteManager = null;
                
                try {
                    // Try direct property access first
                    relayerClient = serviceSdk.relayerClient;
                } catch (e) {
                    // Property might not exist or might throw
                }
                
                try {
                    merkleTreeClient = serviceSdk.merkleTreeClient;
                } catch (e) {
                    // Property might not exist
                }
                
                try {
                    walletProvider = serviceSdk.walletProvider;
                } catch (e) {
                    // Property might not exist
                }
                
                try {
                    noteManager = serviceSdk.noteManager;
                } catch (e) {
                    // Property might not exist
                }
                
                // Also check if they're available through cipherPayService methods
                // (since CipherPayService accesses them as this.sdk.merkleTreeClient)
                if (!merkleTreeClient && cipherPayService.sdk?.merkleTreeClient) {
                    merkleTreeClient = cipherPayService.sdk.merkleTreeClient;
                }
                
                if (!relayerClient && cipherPayService.sdk?.relayerClient) {
                    relayerClient = cipherPayService.sdk.relayerClient;
                }
                
                if (!walletProvider && cipherPayService.sdk?.walletProvider) {
                    walletProvider = cipherPayService.sdk.walletProvider;
                }
                
                if (!noteManager && cipherPayService.sdk?.noteManager) {
                    noteManager = cipherPayService.sdk.noteManager;
                }
                
                setSdkStatus({
                    hasRelayerClient: !!relayerClient,
                    hasMerkleTreeClient: !!merkleTreeClient,
                    hasWalletProvider: !!walletProvider,
                    hasNoteManager: !!noteManager,
                });
                
                // Debug logging - log SDK structure to help diagnose
                const sdkKeys = serviceSdk ? Object.keys(serviceSdk).filter(k => !k.startsWith('_') && typeof serviceSdk[k] !== 'function') : [];
                console.log('[SDKStatus] SDK check:', {
                    hasSDK: !!serviceSdk,
                    relayerClient: !!relayerClient,
                    merkleTreeClient: !!merkleTreeClient,
                    walletProvider: !!walletProvider,
                    noteManager: !!noteManager,
                    sdkPropertyKeys: sdkKeys.slice(0, 20), // First 20 keys
                    sdkType: serviceSdk?.constructor?.name || typeof serviceSdk
                });
            } else {
                setSdkStatus({
                    hasRelayerClient: false,
                    hasMerkleTreeClient: false,
                    hasWalletProvider: false,
                    hasNoteManager: false
                });
            }
        };

        if (isInitialized) {
            checkSDKStatus();

            // Re-check periodically in case SDK initializes components lazily
            const interval = setInterval(checkSDKStatus, 2000);
            return () => clearInterval(interval);
        }
    }, [sdk, isInitialized]);

    // Check backend availability for components that have fallbacks
    // Only check once on mount, not continuously
    useEffect(() => {
        const checkBackendAvailability = async () => {
            if (!isInitialized) {
                setBackendStatus({ merkleTreeAvailable: false, noteManagerAvailable: false, checking: false });
                return;
            }

            const getServerUrl = () => {
                return (import.meta.env.VITE_SERVER_URL && String(import.meta.env.VITE_SERVER_URL).trim()) || '';
            };

            const serverUrl = getServerUrl();
            const token = localStorage.getItem('cipherpay_token');

            setBackendStatus({ merkleTreeAvailable: false, noteManagerAvailable: false, checking: true });

            // Check Merkle Tree endpoint
            // Note: This endpoint might not exist (404), which means "not available"
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000);
                
                const merkleResponse = await fetch(`${serverUrl}/api/v1/merkle/root`, {
                    method: 'GET',
                    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                
                // Only consider available if endpoint exists (200, 401, 403) but not 404
                const merkleAvailable = merkleResponse.status !== 404 && (merkleResponse.ok || merkleResponse.status === 401 || merkleResponse.status === 403);
                setBackendStatus(prev => ({ ...prev, merkleTreeAvailable: merkleAvailable }));
            } catch (error) {
                // Network errors, timeouts, or 404s mean endpoint is not available
                if (error.name !== 'AbortError') {
                    console.log('[SDKStatus] Merkle tree backend check:', error.message);
                }
                setBackendStatus(prev => ({ ...prev, merkleTreeAvailable: false }));
            }

            // Check Note Manager endpoint (messages endpoint)
            // This endpoint should exist and is used for fetching notes
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000);
                
                const messagesResponse = await fetch(`${serverUrl}/api/v1/messages?limit=1`, {
                    method: 'GET',
                    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                
                // 200 = available, 401/403 = endpoint exists but needs auth, 404 = not available
                const notesAvailable = messagesResponse.status !== 404 && (messagesResponse.ok || messagesResponse.status === 401 || messagesResponse.status === 403);
                setBackendStatus(prev => ({ ...prev, noteManagerAvailable: notesAvailable }));
            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.log('[SDKStatus] Note manager backend check:', error.message);
                }
                setBackendStatus(prev => ({ ...prev, noteManagerAvailable: false }));
            }

            // Mark checking as complete
            setBackendStatus(prev => ({ ...prev, checking: false }));
        };

        if (isInitialized) {
            // Only check once on mount, not continuously
            checkBackendAvailability();
        } else {
            setBackendStatus({ merkleTreeAvailable: false, noteManagerAvailable: false, checking: false });
        }
    }, [isInitialized]);

    const badgeClasses = (ok, checking) =>
        ok
            ? 'bg-green-500/15 text-green-400'
            : checking
            ? 'bg-white/10 text-gray-400'
            : 'bg-yellow-500/15 text-yellow-400';

    if (!isInitialized) {
        return (
            <div className="rounded-xl border border-white/10 bg-[#0d1220] p-6">
                <h2 className="mb-4 text-base font-semibold text-white">SDK Status</h2>
                <div className="text-sm text-gray-400">SDK not initialized</div>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-white/10 bg-[#0d1220] p-6">
            <h2 className="mb-4 text-base font-semibold text-white">SDK Components Status</h2>

            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">Relayer Client</span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeClasses(sdkStatus.hasRelayerClient, false)}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${sdkStatus.hasRelayerClient ? 'bg-green-400' : 'bg-yellow-400'}`} />
                        {sdkStatus.hasRelayerClient ? 'Available' : 'Not Available'}
                    </span>
                </div>

                <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">Merkle Tree Client</span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeClasses(sdkStatus.hasMerkleTreeClient || backendStatus.merkleTreeAvailable, backendStatus.checking)}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${
                            (sdkStatus.hasMerkleTreeClient || backendStatus.merkleTreeAvailable) ? 'bg-green-400' : backendStatus.checking ? 'bg-gray-400' : 'bg-yellow-400'
                        }`} />
                        {sdkStatus.hasMerkleTreeClient
                            ? 'Available (SDK)'
                            : backendStatus.merkleTreeAvailable
                                ? 'Available (Backend)'
                                : backendStatus.checking
                                    ? 'Checking...'
                                    : 'Not Available'}
                    </span>
                </div>

                <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">Wallet Provider</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2.5 py-0.5 text-xs font-medium text-green-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                        {sdkStatus.hasWalletProvider ? 'Available (SDK)' : 'Available (Solana Adapter)'}
                    </span>
                </div>

                <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">Note Manager</span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeClasses(sdkStatus.hasNoteManager || backendStatus.noteManagerAvailable, backendStatus.checking)}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${
                            (sdkStatus.hasNoteManager || backendStatus.noteManagerAvailable) ? 'bg-green-400' : backendStatus.checking ? 'bg-gray-400' : 'bg-yellow-400'
                        }`} />
                        {sdkStatus.hasNoteManager
                            ? 'Available (SDK)'
                            : backendStatus.noteManagerAvailable
                                ? 'Available (Backend)'
                                : backendStatus.checking
                                    ? 'Checking...'
                                    : 'Not Available'}
                    </span>
                </div>
            </div>

            {sdk && (
                <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-3">
                    <h3 className="mb-2 text-sm font-medium text-gray-300">SDK Configuration</h3>
                    <div className="space-y-0.5 font-mono text-xs text-gray-400">
                        <div>Chain Type: {sdk.config?.chainType || 'Unknown'}</div>
                        <div>RPC URL: {sdk.config?.rpcUrl || 'Not set'}</div>
                        <div>Relayer URL: {sdk.config?.relayerUrl || 'Not set'}</div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default SDKStatus; 