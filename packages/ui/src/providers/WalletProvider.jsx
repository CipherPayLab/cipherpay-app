import React, { useMemo } from 'react';
import { ConnectionProvider, WalletProvider as SolanaWalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import {
    PhantomWalletAdapter,
    SolflareWalletAdapter,
    LedgerWalletAdapter,
    TorusWalletAdapter,
    CoinbaseWalletAdapter,
    WalletConnectWalletAdapter,
} from '@solana/wallet-adapter-wallets';

// Import wallet adapter CSS
import '@solana/wallet-adapter-react-ui/styles.css';

// Determine network from environment or default to devnet
const getNetwork = () => {
    const networkEnv = import.meta.env.VITE_SOLANA_NETWORK;
    if (networkEnv === 'mainnet-beta') {
        return WalletAdapterNetwork.Mainnet;
    } else if (networkEnv === 'testnet') {
        return WalletAdapterNetwork.Testnet;
    }
    // Default to devnet
    return WalletAdapterNetwork.Devnet;
};

// Get RPC endpoint from environment or use default
// Production: devnet (public RPC). Development: localhost for local validator.
const getRpcEndpoint = () => {
    return import.meta.env.VITE_SOLANA_RPC_URL || import.meta.env.VITE_RPC_URL
        || (import.meta.env.PROD ? 'https://api.devnet.solana.com' : 'http://127.0.0.1:8899');
};

export function WalletProvider({ children }) {
    // The network can be set to 'devnet', 'testnet', or 'mainnet-beta'
    const network = getNetwork();
    const endpoint = useMemo(() => getRpcEndpoint(), []);

    // Configure wallets
    const wallets = useMemo(() => {
        const walletList = [
            new PhantomWalletAdapter(),
            new SolflareWalletAdapter(),
            new LedgerWalletAdapter(),
            new TorusWalletAdapter(),
            new CoinbaseWalletAdapter(),
        ];

        // Only include WalletConnect if a valid project ID is provided
        // WalletConnect requires a real project ID from https://cloud.walletconnect.com
        const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
        if (walletConnectProjectId && walletConnectProjectId !== 'your-project-id') {
            try {
                walletList.push(
                    new WalletConnectWalletAdapter({
                        network,
                        options: {
                            projectId: walletConnectProjectId,
                        },
                    })
                );
            } catch (error) {
                console.warn('Failed to initialize WalletConnect adapter:', error);
            }
        }

        return walletList;
    }, [network]);

    return (
        <ConnectionProvider endpoint={endpoint}>
            <SolanaWalletProvider wallets={wallets} autoConnect={false}>
                <WalletModalProvider>
                    {children}
                </WalletModalProvider>
            </SolanaWalletProvider>
        </ConnectionProvider>
    );
}

export default WalletProvider;

