import React, { useState, useEffect, useRef } from 'react';
import { useCipherPay } from '../contexts/CipherPayContext';
import cipherPayService from '../services';

function SolanaStatus() {
    const { isInitialized, error, sdk } = useCipherPay();
    const [relayerStatus, setRelayerStatus] = useState('checking');
    const [relayerStatusMessage, setRelayerStatusMessage] = useState('Checking relayer status...');
    const [lastCheckTime, setLastCheckTime] = useState(null);
    const [merkleRoot, setMerkleRoot] = useState(null);
    const [circuits, setCircuits] = useState([]);
    const intervalRef = useRef(null);
    const isMountedRef = useRef(true);

    // Get server URL (backend server that proxies to relayer)
    // Same as authService: empty string = same-origin (dev Vite proxy or prod single domain)
    const getServerUrl = () => {
        return (import.meta.env.VITE_SERVER_URL && String(import.meta.env.VITE_SERVER_URL).trim()) || '';
    };

    const checkRelayerStatus = async () => {
        if (!isMountedRef.current) return;

        try {
            const serverUrl = getServerUrl();
            console.log('[SolanaStatus] Checking relayer health through backend at:', serverUrl);
            let status = 'unreachable';
            let message = 'Relayer unreachable';

            // Check relayer health through backend server proxy
            // Frontend → Backend (cipherpay-server) → Relayer (cipherpay-relayer-solana)
            try {
                const healthUrl = `${serverUrl}/relayer/health`;
                // Create AbortController for timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);

                // Get auth token if available (endpoint is public but token might be needed)
                const token = localStorage.getItem('cipherpay_token');
                const headers = {
                    'Content-Type': 'application/json',
                };
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }

                const response = await fetch(healthUrl, {
                    method: 'GET',
                    headers,
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const contentType = response.headers.get('content-type');
                if (!contentType || !contentType.includes('application/json')) {
                    throw new Error('Response is not JSON');
                }

                const data = await response.json();

                // Handle different health status formats
                if (data.status) {
                    status = data.status === 'healthy' || data.status === 'alive' ? 'healthy' :
                            data.status === 'degraded' ? 'degraded' :
                            data.status === 'unhealthy' ? 'unhealthy' : 'unhealthy';
                } else if (data.ok) {
                    status = 'healthy';
                }

                message = data.message || getStatusMessage(status);

                if (isMountedRef.current) {
                    setRelayerStatus(status);
                    setRelayerStatusMessage(message);
                    setLastCheckTime(new Date());
                }
            } catch (fetchError) {
                if (fetchError.name === 'AbortError') {
                    console.error('Relayer health check timed out');
                    if (isMountedRef.current) {
                        setRelayerStatus('unreachable');
                        setRelayerStatusMessage(`Backend server did not respond in time. Check if the backend and relayer services are running.`);
                        setLastCheckTime(new Date());
                    }
                } else {
                    console.error('Failed to check relayer status:', fetchError);
                    if (isMountedRef.current) {
                        setRelayerStatus('unreachable');
                        setRelayerStatusMessage(`Cannot reach relayer through backend at ${serverUrl}. Make sure both backend and relayer services are running.`);
                        setLastCheckTime(new Date());
                    }
                }
            }
        } catch (error) {
            console.error('Error checking relayer status:', error);
            if (isMountedRef.current) {
                setRelayerStatus('unreachable');
                setRelayerStatusMessage('Failed to check relayer status');
                setLastCheckTime(new Date());
            }
        }
    };

    const getStatusMessage = (status) => {
        switch (status) {
            case 'healthy':
                return 'Relayer is operational';
            case 'degraded':
                return 'Relayer is running but may have issues';
            case 'unhealthy':
                return 'Relayer is not functioning properly';
            case 'unreachable':
                return 'Cannot connect to relayer';
            default:
                return 'Checking relayer status...';
        }
    };


    const fetchMerkleRoot = async () => {
        if (!isMountedRef.current) return;

        // Prefer backend (works in browser; SDK merkle client often unavailable)
        const serverUrl = getServerUrl();
        try {
            const response = await fetch(`${serverUrl}/api/v1/merkle/root`);
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) throw new Error('Response is not JSON');
            const data = await response.json();
            if (data.success && isMountedRef.current) {
                setMerkleRoot(data.root);
            }
        } catch (error) {
            if (isMountedRef.current) {
                try {
                    const root = await cipherPayService.fetchMerkleRoot();
                    if (isMountedRef.current) setMerkleRoot(root);
                } catch (_) {
                    // Expected in browser when merkle client not available — no log
                }
            }
        }
    };

    const fetchCircuits = async () => {
        if (!isMountedRef.current) return;

        const serverUrl = getServerUrl();
        try {
            const response = await fetch(`${serverUrl}/api/v1/circuits`);
            if (response.status === 404) {
                // Backend has no circuits endpoint — use empty list (UI has circuits in public/circuits)
                if (isMountedRef.current) setCircuits([]);
                return;
            }
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) throw new Error('Response is not JSON');
            const data = await response.json();
            if (data.success && isMountedRef.current) setCircuits(data.circuits || []);
        } catch (error) {
            if (isMountedRef.current) setCircuits([]);
            // No console.error — 404 / missing endpoint is expected
        }
    };

    // Initial fetch and periodic health checks
    useEffect(() => {
        if (!isInitialized) {
            return;
        }

        isMountedRef.current = true;

        // Initial fetch
        checkRelayerStatus();
        fetchMerkleRoot();
        fetchCircuits();

        // Set up periodic health checks every 15 seconds
        intervalRef.current = setInterval(() => {
            checkRelayerStatus();
        }, 15000);

        return () => {
            isMountedRef.current = false;
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [isInitialized, sdk]);

    const getStatusBadgeClasses = (status) => {
        switch (status) {
            case 'healthy':
                return 'bg-green-500/15 text-green-400';
            case 'degraded':
                return 'bg-yellow-500/15 text-yellow-400';
            case 'unhealthy':
                return 'bg-red-500/15 text-red-400';
            case 'unreachable':
                return 'bg-orange-500/15 text-orange-400';
            default:
                return 'bg-white/10 text-gray-400';
        }
    };

    const getStatusDotClasses = (status) => {
        switch (status) {
            case 'healthy':
                return 'bg-green-400';
            case 'degraded':
                return 'bg-yellow-400';
            case 'unhealthy':
                return 'bg-red-400';
            case 'unreachable':
                return 'bg-orange-400';
            default:
                return 'bg-gray-400';
        }
    };

    const formatLastCheckTime = (date) => {
        if (!date) return '';
        const now = new Date();
        const diff = Math.floor((now - date) / 1000);
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        return date.toLocaleTimeString();
    };

    return (
        <div className="rounded-xl border border-white/10 bg-[#0d1220] p-6">
            <h2 className="mb-4 text-base font-semibold text-white">Solana Integration Status</h2>

            <div className="space-y-4">
                {/* Service Status */}
                <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">CipherPay Service</span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${isInitialized ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${isInitialized ? 'bg-green-400' : 'bg-red-400'}`} />
                        {isInitialized ? 'Operational' : 'Not Initialized'}
                    </span>
                </div>

                {/* Relayer Status */}
                <div className="space-y-1">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-400">Solana Relayer</span>
                            <div className="group relative">
                                <svg className="h-4 w-4 cursor-help text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                                </svg>
                                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-64 -translate-x-1/2 transform rounded-lg border border-white/10 bg-[#05070f] p-2 text-xs text-gray-300 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
                                    The Solana Relayer (cipherpay-relayer-solana) maintains the Merkle tree for private notes, computes zero-knowledge proofs, and submits transactions to Solana on your behalf. It enables gasless, private transactions. Health status is checked through the backend server (cipherpay-server).
                                </div>
                            </div>
                        </div>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${getStatusBadgeClasses(relayerStatus)}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${getStatusDotClasses(relayerStatus)}`} />
                            {relayerStatus === 'checking' ? 'Checking...' : relayerStatus.charAt(0).toUpperCase() + relayerStatus.slice(1)}
                        </span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">{relayerStatusMessage}</span>
                        {lastCheckTime && (
                            <span className="text-xs text-gray-500">
                                Last check: {formatLastCheckTime(lastCheckTime)}
                            </span>
                        )}
                    </div>
                </div>

                {/* Merkle Root */}
                {merkleRoot && (
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-400">Merkle Root</span>
                        <span className="font-mono text-xs text-gray-300">
                            {merkleRoot.slice(0, 10)}...{merkleRoot.slice(-8)}
                        </span>
                    </div>
                )}

                {/* Supported Circuits */}
                {circuits.length > 0 && (
                    <div>
                        <span className="text-sm text-gray-400">Supported Circuits</span>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {circuits.map((circuit, index) => (
                                <span
                                    key={index}
                                    className="inline-flex items-center rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-medium text-blue-300"
                                >
                                    {circuit.name}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Error Display */}
                {error && (
                    <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
                        <h3 className="text-sm font-medium text-red-300">Error</h3>
                        <p className="mt-2 text-sm text-red-400">{error}</p>
                    </div>
                )}
            </div>
        </div>
    );
}

export default SolanaStatus;
