// CipherPayService - Production/Real SDK Service
// This service provides full integration with the real CipherPay SDK
// Used for production environments and real blockchain interactions
// 
// Environment Variables:
// - REACT_APP_USE_REAL_SDK=true: Use this service (default when SDK is available)
// - REACT_APP_USE_FALLBACK_SERVICE=false: Use this service
// 
// Features:
// - Full SDK integration with Solana blockchain
// - Real wallet connections and transactions
// - ZK proof generation and verification
// - Event monitoring and compliance
// - Production-ready error handling

// Same as authService: empty string = same-origin (dev Vite proxy or prod single domain)
const getServerBaseUrl = () => (import.meta.env.VITE_SERVER_URL && String(import.meta.env.VITE_SERVER_URL).trim()) || '';

// Replace HTML or non-user-friendly error content with a clear message
const sanitizeErrorMessage = (msg) => {
    if (!msg || typeof msg !== 'string') return 'An unexpected error occurred.';
    if (msg.includes('<!') || msg.includes('<html') || msg.includes('<body') || msg.includes('<pre>')) {
        if (msg.includes('Internal Server Error') || msg.includes('500')) {
            return 'The selected note could not be withdrawn. It may have already been spent - please refresh your notes and try again.';
        }
        return 'The operation failed. Please refresh and try again.';
    }
    return msg;
};

// Import SDK loader to get the global SDK instance
import { loadSDK, getSDKStatus } from './sdkLoader';
import { fetchAccountOverview, fetchMessages, decryptMessages, computeAccountOverview } from './accountOverviewService';
import { encryptForRecipient, encryptForSender, getLocalEncPublicKeyB64 } from '../lib/e2ee';

class CipherPayService {
    constructor() {
        this.sdk = null;
        this.isInitialized = false;
        this.walletAddress = null; // Store wallet address from external wallet adapter
        this.eventListeners = {}; // Event listeners for deposit completion, etc.
        this.eventMonitoringActive = false;
        this.stopEventStream = null;
        this.config = {
            chainType: 'solana', // Use string instead of ChainType enum
            rpcUrl: import.meta.env.VITE_RPC_URL || import.meta.env.VITE_SOLANA_RPC_URL || (import.meta.env.PROD ? 'https://api.devnet.solana.com' : 'http://127.0.0.1:8899'),
            relayerUrl: import.meta.env.VITE_RELAYER_URL || getServerBaseUrl(),
            relayerApiKey: import.meta.env.VITE_RELAYER_API_KEY,
            contractAddress: import.meta.env.VITE_CONTRACT_ADDRESS,
            programId: import.meta.env.VITE_PROGRAM_ID || 'WRy4hstBsD6hxb7CJN4R3fgLnafs621N7EjUhZ2afze', // Solana program ID
            enableCompliance: true,
            enableCaching: true,
            enableStealthAddresses: true,
            cacheConfig: {
                maxSize: 1000,
                defaultTTL: 300000 // 5 minutes
            },
            // Add authentication configuration for relayer
            auth: {
                email: import.meta.env.VITE_RELAYER_EMAIL,
                password: import.meta.env.VITE_RELAYER_PASSWORD,
                apiKey: import.meta.env.VITE_RELAYER_API_KEY
            }
        };
        console.log('CipherPayService constructor - config:', this.config);
    }

    async initialize() {
        try {
            console.log('Initializing CipherPay SDK...');

            // Load the SDK from global scope
            let { CipherPaySDK: sdkClass, ChainType, sdkInitialized } = await loadSDK();

            if (!sdkInitialized || !sdkClass) {
                // Fallback: if loader returned null but window has the class (e.g. production), use it
                if (typeof window !== 'undefined' && typeof window.CipherPaySDK === 'function' &&
                    window.CipherPaySDK.prototype && window.CipherPaySDK.prototype.constructor === window.CipherPaySDK) {
                    sdkClass = window.CipherPaySDK;
                } else if (typeof window !== 'undefined' && typeof window.CipherPaySDK !== 'undefined') {
                    throw new Error('CipherPaySDK found in global scope but is not a constructor class. The SDK appears to export utility functions only.');
                } else {
                    throw new Error('CipherPay SDK not available in global scope. Ensure the SDK bundle is loaded via script tag in index.html');
                }
            }

            // Configure circuit files for browser compatibility
            const circuitConfig = {
                transfer: {
                    wasmUrl: import.meta.env.VITE_TRANSFER_WASM_URL || '/circuits/transfer.wasm',
                    zkeyUrl: import.meta.env.VITE_TRANSFER_ZKEY_URL || '/circuits/transfer.zkey',
                    verificationKeyUrl: import.meta.env.VITE_TRANSFER_VKEY_URL || '/circuits/verifier-transfer.json'
                },
                merkle: {
                    wasmUrl: import.meta.env.VITE_MERKLE_WASM_URL || '/circuits/merkle.wasm',
                    zkeyUrl: import.meta.env.VITE_MERKLE_ZKEY_URL || '/circuits/merkle.zkey',
                    verificationKeyUrl: import.meta.env.VITE_MERKLE_VKEY_URL || '/circuits/verifier-merkle.json'
                },
                withdraw: {
                    wasmUrl: '/circuits/withdraw.wasm',
                    zkeyUrl: '/circuits/withdraw.zkey',
                    verificationKeyUrl: '/circuits/verifier-withdraw.json'
                },
                nullifier: {
                    wasmUrl: '/circuits/nullifier.wasm',
                    zkeyUrl: '/circuits/nullifier.zkey',
                    verificationKeyUrl: '/circuits/verifier-nullifier.json'
                },
                audit_proof: {
                    wasmUrl: '/circuits/audit_proof.wasm',
                    zkeyUrl: '/circuits/audit_proof.zkey',
                    verificationKeyUrl: '/circuits/verifier-audit_proof.json'
                }
            };

            // Initialize the SDK with configuration
            const sdkConfig = {
                ...this.config,
                circuitConfig
            };
            console.log('Creating SDK instance with config:', JSON.stringify(sdkConfig, null, 2));
            console.log('Program ID in sdkConfig:', sdkConfig.programId);

            this.sdk = new sdkClass(sdkConfig);

            // Event monitoring is now handled via SSE in startEventMonitoring()
            console.log('SDK initialized. Call startEventMonitoring(recipientKey) to monitor on-chain events.');

            this.isInitialized = true;
            console.log('CipherPay SDK initialized successfully');
        } catch (error) {
            console.error('Failed to initialize CipherPay SDK:', error);
            throw error;
        }
    }

    // Wallet Management
    async connectWallet(walletAddress = null) {
        if (!this.isInitialized) await this.initialize();

        try {
            // Wallet connection is managed externally by Solana wallet adapter
            // We just store the wallet address here
            if (walletAddress) {
                this.walletAddress = walletAddress;
                console.log('[CipherPayService] connectWallet: Stored wallet address:', walletAddress);
                return walletAddress;
            }
            
            // If no address provided, try to get from SDK (fallback)
            if (this.sdk?.walletProvider?.getPublicAddress) {
                const address = this.sdk.walletProvider.getPublicAddress();
                if (address) {
                    this.walletAddress = address;
                    console.log('[CipherPayService] connectWallet: Got address from SDK:', address);
                    return address;
                }
            }
            
            console.warn('[CipherPayService] connectWallet: No wallet address provided and SDK has none');
            return null;
        } catch (error) {
            console.error('Failed to connect wallet:', error);
            throw error;
        }
    }
    
    setWalletAddress(address) {
        this.walletAddress = address;
        console.log('[CipherPayService] setWalletAddress:', address);
    }

    async disconnectWallet() {
        // Clear stored wallet address
        this.walletAddress = null;
        console.log('[CipherPayService] disconnectWallet: Cleared wallet address');
        
        // Try to disconnect from SDK wallet provider if it exists
        if (this.sdk?.walletProvider?.disconnect) {
            try {
                await this.sdk.walletProvider.disconnect();
            } catch (error) {
                console.error('Failed to disconnect SDK wallet:', error);
                // Don't throw - wallet is managed externally
            }
        }
    }

    getPublicAddress() {
        try {
            // First check if we have a stored wallet address from external wallet adapter
            if (this.walletAddress) {
                console.log('[CipherPayService] getPublicAddress: Using stored address:', this.walletAddress);
                return this.walletAddress;
            }
            
            // Fallback to SDK wallet provider
            const address = this.sdk?.walletProvider?.getPublicAddress?.();
            console.log('[CipherPayService] getPublicAddress: SDK address:', address);
            return address || null;
        } catch (error) {
            if (error.message && error.message.includes('No wallet connected')) {
                return null;
            }
            console.error('Error getting public address:', error);
            return null;
        }
    }

    // Note Management
    // ALWAYS get notes from backend (database), never from SDK
    async getSpendableNotes() {
        try {
            // Fetch messages from backend DB, decrypt them, and get account overview
            const overview = await this.getAccountOverviewFromBackend({ checkOnChain: false });
            // Filter out spent notes and return in the format expected by transfer
            const spendable = (overview.notes || []).filter(n => !n.isSpent);
            // Convert to the format expected by createTransaction
            // Backend returns amounts as hex strings, convert to BigInt
            return spendable.map(n => ({
                amount: typeof n.amount === 'string' && n.amount.startsWith('0x') 
                    ? BigInt(n.amount) 
                    : BigInt(n.amount),
                tokenId: typeof n.note.tokenId === 'string' && n.note.tokenId.startsWith('0x')
                    ? BigInt(n.note.tokenId)
                    : BigInt(n.note.tokenId),
                ownerCipherPayPubKey: typeof n.note.ownerCipherPayPubKey === 'string' && n.note.ownerCipherPayPubKey.startsWith('0x')
                    ? BigInt(n.note.ownerCipherPayPubKey)
                    : BigInt(n.note.ownerCipherPayPubKey),
                randomness: {
                    r: typeof n.note.randomness.r === 'string' && n.note.randomness.r.startsWith('0x')
                        ? BigInt(n.note.randomness.r)
                        : BigInt(n.note.randomness.r),
                    s: n.note.randomness.s 
                        ? (typeof n.note.randomness.s === 'string' && n.note.randomness.s.startsWith('0x')
                            ? BigInt(n.note.randomness.s)
                            : BigInt(n.note.randomness.s))
                        : undefined,
                },
                memo: n.note.memo 
                    ? (typeof n.note.memo === 'string' && n.note.memo.startsWith('0x')
                        ? BigInt(n.note.memo)
                        : BigInt(n.note.memo))
                    : 0n,
            }));
        } catch (error) {
            console.error('[CipherPayService] Failed to get spendable notes from backend:', error);
            return [];
        }
    }

    async getAllNotes() {
        if (!this.isInitialized) await this.initialize();
        try {
            const notes = await this.sdk.getNotes();
            return Array.isArray(notes) ? notes : [];
        } catch (error) {
            console.error('Failed to get notes from SDK:', error);
            return [];
        }
    }

    getBalance() {
        const balance = this.sdk?.getBalance();
        console.log('[CipherPayService] getBalance:', balance);
        return balance || 0n;
    }

    // Get stored ATA from database (via backend API)
    async getUserAta() {
        if (!this.isInitialized) await this.initialize();
        
        try {
            // Import authService dynamically to avoid circular dependencies
            const authService = (await import('./authService.js')).default;
            
            // Get user info which includes stored ATA
            const userData = await authService.getMe();
            
            return {
                wsolAta: userData.wsolAta || null,
                solanaWalletAddress: userData.solanaWalletAddress || null,
            };
        } catch (error) {
            console.error('[CipherPayService] Failed to get user ATA from DB:', error);
            return {
                wsolAta: null,
                solanaWalletAddress: null,
            };
        }
    }


    addNote(note) {
        if (this.sdk?.noteManager) {
            this.sdk.noteManager.addNote(note);
        }
    }

    // Transaction Management - Transfer
    // Note Selection Strategy:
    // 1. Try to find a single note with amount >= transfer amount
    // 2. If not found, select multiple notes (biggest to smallest) and transfer one by one
    async createTransaction(recipientPublicKey, amount, inputNote = null) {
        if (!this.isInitialized) await this.initialize();

        try {
            console.log('[CipherPayService] createTransaction called with params:', {
                recipientPublicKey,
                amount: amount.toString(),
                inputNote: inputNote ? 'provided' : 'not provided'
            });

            // Validate required parameters
            if (!recipientPublicKey) throw new Error('Recipient public key is required');
            if (!amount || amount <= 0n) throw new Error('Amount must be greater than 0');
            
            // Minimum transfer amount: 0.001 SOL (1,000,000 atoms)
            const MIN_TRANSFER_AMOUNT = 1_000_000n; // 0.001 SOL
            if (amount < MIN_TRANSFER_AMOUNT) {
                throw new Error(`Minimum transfer amount is 0.001 SOL. Requested: ${(Number(amount) / 1e9).toFixed(9)} SOL`);
            }

            // Check if SDK transfer function is available
            if (!window.CipherPaySDK?.transfer) {
                throw new Error('SDK transfer function not available. Ensure the SDK bundle is loaded.');
            }

            // Get identity from stored keys
            const identity = await this.getIdentity();
            if (!identity) {
                throw new Error('Identity not found. Please authenticate first.');
            }

            // Validate: Prevent transfers to self
            // Compute sender's ownerCipherPayPubKey from identity wallet keys
            const ownerWalletPubKey = identity.ownerWalletPubKey || BigInt(0);
            const ownerWalletPrivKey = identity.ownerWalletPrivKey || BigInt(0);
            
            // Derive sender's ownerCipherPayPubKey using poseidonHash (same as SDK does)
            const { poseidonHash } = window.CipherPaySDK || {};
            if (!poseidonHash) {
                throw new Error('SDK poseidonHash not available');
            }
            const senderOwnerCipherPayPubKey = await poseidonHash([ownerWalletPubKey, ownerWalletPrivKey]);
            const senderOwnerKeyHex = '0x' + senderOwnerCipherPayPubKey.toString(16).padStart(64, '0').toLowerCase();
            
            // Normalize recipient public key for comparison
            let normalizedRecipientKey;
            if (typeof recipientPublicKey === 'string') {
                normalizedRecipientKey = recipientPublicKey.startsWith('0x')
                    ? recipientPublicKey.toLowerCase()
                    : '0x' + recipientPublicKey.toLowerCase();
            } else {
                normalizedRecipientKey = '0x' + recipientPublicKey.toString(16).padStart(64, '0').toLowerCase();
            }
            
            if (normalizedRecipientKey === senderOwnerKeyHex) {
                alert('Cannot transfer to yourself!');
                throw new Error('Cannot transfer to yourself!');
            }

            // Validate: Recipient must exist in database and have valid keys
            const serverUrl = getServerBaseUrl();
            const authToken = localStorage.getItem('cipherpay_token');
            
            // Helper function to validate owner_cipherpay_pub_key format
            const validateOwnerCipherPayPubKey = (key) => {
                if (!key || typeof key !== 'string') {
                    return { valid: false, error: 'owner_cipherpay_pub_key must be a string' };
                }
                
                // Must start with 0x
                if (!key.startsWith('0x')) {
                    return { valid: false, error: 'owner_cipherpay_pub_key must start with 0x' };
                }
                
                // Must be exactly 66 characters (0x + 64 hex digits)
                if (key.length !== 66) {
                    return { valid: false, error: `owner_cipherpay_pub_key must be 66 characters (got ${key.length})` };
                }
                
                // Must be valid hex (only 0-9, a-f, A-F after 0x)
                const hexPart = key.substring(2);
                if (!/^[0-9a-fA-F]+$/.test(hexPart)) {
                    return { valid: false, error: 'owner_cipherpay_pub_key contains invalid hex characters' };
                }
                
                // Must be a valid BigInt
                try {
                    const keyBigInt = BigInt(key);
                    if (keyBigInt === 0n) {
                        return { valid: false, error: 'owner_cipherpay_pub_key cannot be zero' };
                    }
                } catch (e) {
                    return { valid: false, error: `owner_cipherpay_pub_key is not a valid BigInt: ${e.message}` };
                }
                
                return { valid: true };
            };
            
            // Helper function to validate note_enc_pub_key format (base64 Curve25519 public key)
            const validateNoteEncPubKey = (key) => {
                if (!key || typeof key !== 'string') {
                    return { valid: false, error: 'note_enc_pub_key must be a string' };
                }
                
                // Base64 encoded Curve25519 public key should be 44 characters (32 bytes = 44 base64 chars)
                // With padding it could be 44-48 characters
                if (key.length < 44 || key.length > 48) {
                    return { valid: false, error: `note_enc_pub_key must be 44-48 characters (got ${key.length})` };
                }
                
                // Must be valid base64
                try {
                    // Try to decode base64
                    const decoded = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
                    const bytes = new Uint8Array(decoded.length);
                    for (let i = 0; i < decoded.length; i++) {
                        bytes[i] = decoded.charCodeAt(i);
                    }
                    
                    // Curve25519 public key must be exactly 32 bytes
                    if (bytes.length !== 32) {
                        return { valid: false, error: `note_enc_pub_key must decode to exactly 32 bytes (got ${bytes.length})` };
                    }
                } catch (e) {
                    return { valid: false, error: `note_enc_pub_key is not valid base64: ${e.message}` };
                }
                
                return { valid: true };
            };
            
            // Validate recipient's owner_cipherpay_pub_key format
            const ownerKeyValidation = validateOwnerCipherPayPubKey(normalizedRecipientKey);
            if (!ownerKeyValidation.valid) {
                console.error('[CipherPayService] Invalid owner_cipherpay_pub_key format:', ownerKeyValidation.error);
                alert('Invalid recipient!');
                throw new Error(`Invalid recipient! ${ownerKeyValidation.error}`);
            }
            
            try {
                const response = await fetch(`${serverUrl}/api/v1/users/note-enc-pub-key/${normalizedRecipientKey}`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
                    },
                });
                
                if (!response.ok) {
                    if (response.status === 404) {
                        alert('Invalid recipient!');
                        throw new Error('Invalid recipient! Recipient not found or missing required keys.');
                    } else {
                        const errorText = await response.text();
                        console.error('[CipherPayService] Failed to validate recipient:', response.status, errorText);
                        alert('Invalid recipient!');
                        throw new Error(`Failed to validate recipient: ${response.status}`);
                    }
                }
                
                const data = await response.json();
                if (!data.noteEncPubKey) {
                    alert('Invalid recipient!');
                    throw new Error('Invalid recipient! Recipient missing note encryption public key.');
                }
                
                // Validate note_enc_pub_key format
                const noteEncKeyValidation = validateNoteEncPubKey(data.noteEncPubKey);
                if (!noteEncKeyValidation.valid) {
                    console.error('[CipherPayService] Invalid note_enc_pub_key format:', noteEncKeyValidation.error);
                    alert('Invalid recipient!');
                    throw new Error(`Invalid recipient! Corrupted note_enc_pub_key: ${noteEncKeyValidation.error}`);
                }
                
                console.log('[CipherPayService] Recipient validated successfully with valid keys');
            } catch (error) {
                // If it's already our custom error, re-throw it
                if (error.message.includes('Invalid recipient') || error.message.includes('Cannot transfer')) {
                    throw error;
                }
                // Otherwise, it's a network/API error
                console.error('[CipherPayService] Error validating recipient:', error);
                alert('Invalid recipient!');
                throw new Error('Invalid recipient! Failed to verify recipient in database.');
            }

            // NOTE SELECTION STRATEGY
            let selectedNotes = [];
            
            if (inputNote) {
                // Use provided note - validate it has enough balance
                const inputNoteAmount = BigInt(inputNote.amount);
                if (inputNoteAmount < MIN_TRANSFER_AMOUNT) {
                    throw new Error(`Input note amount must be at least 0.001 SOL. Current: ${(Number(inputNoteAmount) / 1e9).toFixed(9)} SOL`);
                }
                if (inputNoteAmount < amount) {
                    throw new Error('Available shield balance insufficient');
                }
                selectedNotes = [inputNote];
            } else {
                // Get spendable notes from backend database (queries messages table and checks nullifiers)
                const spendable = await this.getSpendableNotes();
                if (spendable.length === 0) {
                    throw new Error('No spendable notes available. Please deposit funds first.');
                }

                // Filter out notes that are less than minimum transfer amount (0.001 SOL)
                const validNotes = spendable.filter(n => BigInt(n.amount) >= MIN_TRANSFER_AMOUNT);
                if (validNotes.length === 0) {
                    throw new Error('No notes with sufficient amount (minimum 0.001 SOL) available for transfer.');
                }

                // VALIDATION: Check total available balance first
                const totalAvailable = validNotes.reduce((sum, n) => sum + BigInt(n.amount), 0n);
                if (totalAvailable < amount) {
                    throw new Error('Available shield balance insufficient');
                }

                // Strategy 1: Try to find a single note with amount >= transfer amount
                const singleNote = validNotes.find(n => BigInt(n.amount) >= amount);
                
                if (singleNote) {
                    console.log('[CipherPayService] Found single note sufficient for transfer:', {
                        noteAmount: singleNote.amount.toString(),
                        transferAmount: amount.toString()
                    });
                    selectedNotes = [singleNote];
                } else {
                    // Strategy 2: Select multiple notes from biggest to smallest
                    console.log('[CipherPayService] No single note sufficient, selecting multiple notes...');
                    
                    // Sort notes by amount (biggest first)
                    const sortedNotes = [...validNotes].sort((a, b) => {
                        const amountA = BigInt(a.amount);
                        const amountB = BigInt(b.amount);
                        if (amountB > amountA) return 1;
                        if (amountB < amountA) return -1;
                        return 0;
                    });
                    
                    // Select notes until we have enough
                    let totalSelected = 0n;
                    for (const note of sortedNotes) {
                        selectedNotes.push(note);
                        totalSelected += BigInt(note.amount);
                        if (totalSelected >= amount) {
                            break;
                        }
                    }
                    
                    // Double-check if we have enough (should not happen due to earlier validation, but safety check)
                    if (totalSelected < amount) {
                        throw new Error('Available shield balance insufficient');
                    }
                    
                    console.log('[CipherPayService] Selected multiple notes:', {
                        count: selectedNotes.length,
                        totalAmount: totalSelected.toString(),
                        transferAmount: amount.toString(),
                        notes: selectedNotes.map(n => ({ amount: n.amount.toString() }))
                    });
                }
            }

            // If multiple notes selected, execute transfers one by one
            if (selectedNotes.length > 1) {
                console.log('[CipherPayService] Executing', selectedNotes.length, 'transfers sequentially...');
                const results = [];
                let remainingAmount = amount;
                
                for (let i = 0; i < selectedNotes.length; i++) {
                    const note = selectedNotes[i];
                    const noteAmount = BigInt(note.amount);
                    
                    // Calculate transfer amount for this note
                    // For each note, transfer the full note amount to recipient
                    // The last note will have change if needed
                    // But we need to track how much we still need to send
                    const transferAmountForThisNote = remainingAmount <= noteAmount 
                        ? remainingAmount  // Last note or enough: transfer remaining amount
                        : noteAmount;      // Not enough yet: transfer full note amount
                    
                    console.log(`[CipherPayService] Transfer ${i + 1}/${selectedNotes.length}:`, {
                        noteAmount: noteAmount.toString(),
                        transferAmount: transferAmountForThisNote.toString(),
                        remainingAmount: remainingAmount.toString(),
                        willHaveChange: transferAmountForThisNote < noteAmount
                    });
                    
                    // Execute transfer for this note
                    const result = await this.executeSingleTransfer(
                        identity,
                        recipientPublicKey,
                        transferAmountForThisNote,
                        note
                    );
                    
                    results.push(result);
                    remainingAmount -= transferAmountForThisNote;
                    
                    // If we've transferred enough, stop
                    if (remainingAmount <= 0n) {
                        break;
                    }
                }
                
                // Return aggregated result
                return {
                    recipient: recipientPublicKey,
                    amount: amount,
                    timestamp: Date.now(),
                    id: results[results.length - 1]?.txHash || results[0]?.txHash,
                    txHash: results[results.length - 1]?.txHash || results[0]?.txHash,
                    transfers: results,
                    totalTransfers: results.length,
                };
            } else {
                // Single note transfer
                const inputNoteToUse = selectedNotes[0];
                return await this.executeSingleTransfer(
                    identity,
                    recipientPublicKey,
                    amount,
                    inputNoteToUse
                );
            }
        } catch (error) {
            console.error('[CipherPayService] Failed to create transaction:', error);
            throw error;
        }
    }

    // Execute a single transfer with a specific note
    async executeSingleTransfer(identity, recipientPublicKey, amount, inputNoteToUse) {
        try {
            // Validate input note structure
            if (!inputNoteToUse.amount || !inputNoteToUse.tokenId || !inputNoteToUse.ownerCipherPayPubKey || !inputNoteToUse.randomness) {
                throw new Error('Invalid input note structure');
            }

            // Parse recipient public key (should be ownerCipherPayPubKey as hex string or bigint)
            let recipientCipherPayPubKey;
            if (typeof recipientPublicKey === 'string') {
                recipientCipherPayPubKey = recipientPublicKey.startsWith('0x')
                    ? BigInt(recipientPublicKey)
                    : BigInt('0x' + recipientPublicKey);
            } else {
                recipientCipherPayPubKey = BigInt(recipientPublicKey);
            }

            // Validate sufficient balance
            if (inputNoteToUse.amount < amount) {
                throw new Error(`Insufficient balance in selected note. Note amount: ${inputNoteToUse.amount}, requested: ${amount}`);
            }

            // PRIVACY-PRESERVING TRANSFER DESIGN:
            // - If transfer amount == input note amount: Randomly split into two outputs (privacy-preserving)
            // - If transfer amount < input note amount: Output1 = transfer (recipient), Output2 = remainder (sender change)
            const inputAmount = BigInt(inputNoteToUse.amount);
            const transferAmount = amount;
            
            let out1Amount, out2Amount;
            let recipientGetsOut1;
            let recipientAmount, changeAmount;
            
            if (transferAmount === inputAmount) {
                // CASE 1: Transfer amount equals input amount - Full transfer
                // Randomly split the full amount into two outputs, BOTH for recipient
                // This enhances privacy - can't tell which output is the "real" amount
                // Round to 3 decimal places for readability (0.001 SOL = 1,000,000)
                const roundingPrecision = 1_000_000n; // 0.001 SOL (3 decimal places)
                const minAmountPerOutput = 500_000n; // 0.0005 SOL - minimum per output
                
                // inputAmount is already validated to be >= 0.001 SOL (MIN_TRANSFER_AMOUNT)
                // So we can always split into two outputs of at least 0.0005 SOL each
                
                // Generate random split between 1% and 99% (rounded to 0.001 SOL)
                const minPercent = 1n; // 1%
                const maxPercent = 99n; // 99%
                
                // Generate random percentage between minPercent and maxPercent
                const randomBytes = new Uint8Array(1);
                crypto.getRandomValues(randomBytes);
                const randomPercent = minPercent + (BigInt(randomBytes[0]) % (maxPercent - minPercent + 1n));
                
                // Calculate out1Amount as randomPercent of inputAmount, rounded to 0.001 SOL
                const out1AmountUnrounded = (inputAmount * randomPercent) / 100n;
                out1Amount = (out1AmountUnrounded / roundingPrecision) * roundingPrecision;
                
                // Ensure it's at least 0.0005 SOL and at most (inputAmount - 0.0005 SOL)
                // This guarantees both outputs are at least 0.0005 SOL
                const maxAmount = inputAmount - minAmountPerOutput;
                if (out1Amount < minAmountPerOutput) out1Amount = minAmountPerOutput;
                if (out1Amount > maxAmount) out1Amount = maxAmount;
                
                // out2Amount is the remainder
                out2Amount = inputAmount - out1Amount;
                
                // Ensure out2Amount is also at least 0.0005 SOL (defensive check)
                // If rounding caused out2Amount to be less than minAmountPerOutput, adjust
                if (out2Amount < minAmountPerOutput) {
                    // Adjust out1Amount down to ensure out2Amount is at least minAmountPerOutput
                    out1Amount = inputAmount - minAmountPerOutput;
                    out2Amount = minAmountPerOutput;
                }
                
                // Final verification: both must be non-zero and at least 0.0005 SOL
                if (out1Amount === 0n || out2Amount === 0n || out1Amount < minAmountPerOutput || out2Amount < minAmountPerOutput) {
                    // Fallback: split equally (rounded to 0.001 SOL)
                    const halfAmount = (inputAmount / 2n / roundingPrecision) * roundingPrecision;
                    out1Amount = halfAmount;
                    out2Amount = inputAmount - out1Amount;
                    // Ensure both are at least minAmountPerOutput
                    if (out1Amount < minAmountPerOutput) {
                        out1Amount = minAmountPerOutput;
                        out2Amount = inputAmount - out1Amount;
                    }
                    if (out2Amount < minAmountPerOutput) {
                        out2Amount = minAmountPerOutput;
                        out1Amount = inputAmount - out2Amount;
                    }
                }
                
                // Both outputs go to recipient (no change for sender)
                // Randomly decide which output position gets which amount for privacy
                recipientGetsOut1 = crypto.getRandomValues(new Uint8Array(1))[0] % 2 === 0;
                
                // Both amounts go to recipient, so recipientAmount is the sum
                recipientAmount = inputAmount; // Full amount goes to recipient
                changeAmount = 0n; // No change for sender
                
                console.log('[CipherPayService] Full amount transfer - Randomly split (rounded to 0.001 SOL), both outputs for recipient:', {
                    inputAmount: inputAmount.toString(),
                    transferAmount: transferAmount.toString(),
                    randomPercent: randomPercent.toString(),
                    out1Amount: out1Amount.toString(),
                    out2Amount: out2Amount.toString(),
                    recipientGetsOut1,
                    recipientAmount: recipientAmount.toString(),
                    changeAmount: changeAmount.toString(),
                });
            } else {
                // CASE 2: Transfer amount < input amount - Direct split (no privacy needed)
                // Output1: recipient gets exact transfer amount
                // Output2: sender gets remaining balance (change)
                out1Amount = transferAmount;
                out2Amount = inputAmount - transferAmount;
                recipientGetsOut1 = true; // Recipient always gets out1 in this case
                recipientAmount = out1Amount;
                changeAmount = out2Amount;
                
                console.log('[CipherPayService] Partial amount transfer - Direct split:', {
                    inputAmount: inputAmount.toString(),
                    transferAmount: transferAmount.toString(),
                    out1Amount: out1Amount.toString(),
                    out2Amount: out2Amount.toString(),
                    recipientGetsOut1: true,
                    recipientAmount: recipientAmount.toString(),
                    changeAmount: changeAmount.toString(),
                });
            }

            // Get auth token for server API calls
            const authToken = localStorage.getItem('cipherpay_token');
            const serverUrl = getServerBaseUrl();

            // Determine token descriptor from input note (assume same token for outputs)
            // For now, assume wSOL (can be enhanced to support other tokens)
            const tokenDescriptor = {
                chain: 'solana',
                symbol: 'SOL',
                decimals: 9,
                solana: {
                    mint: 'So11111111111111111111111111111111111111112', // wSOL
                    decimals: 9,
                }
            };

            // Import encryption utilities
            const { getLocalEncPublicKeyB64, encryptForRecipient, encryptForSender } = await import('../lib/e2ee');
            
            // Helper function to get recipient's Curve25519 encryption public key from DB
            // Note: note_enc_pub_key in DB is already a Curve25519 public key (base64), used directly
            const getRecipientNoteEncPubKey = async (ownerCipherPayPubKey) => {
                try {
                    const response = await fetch(`${serverUrl}/api/v1/users/note-enc-pub-key/${ownerCipherPayPubKey}`, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
                        },
                    });
                    if (response.ok) {
                        const data = await response.json();
                        return data.noteEncPubKey;
                    } else {
                        console.warn(`[CipherPayService] Failed to get note_enc_pub_key for ${ownerCipherPayPubKey}:`, response.status, response.statusText);
                        return null;
                    }
                } catch (error) {
                    console.error(`[CipherPayService] Error fetching note_enc_pub_key for ${ownerCipherPayPubKey}:`, error);
                    return null;
                }
            };

            // Prepare transfer parameters with privacy-preserving random split
            // Ensure all values are BigInt (defensive conversion from hex strings or numbers)
            const toBigInt = (val) => {
                if (typeof val === 'bigint') return val;
                if (typeof val === 'string' && val.startsWith('0x')) return BigInt(val);
                return BigInt(val);
            };
            
            const convertedAmount = toBigInt(inputNoteToUse.amount);
            const convertedTokenId = toBigInt(inputNoteToUse.tokenId);
            const convertedRandomnessR = toBigInt(inputNoteToUse.randomness.r);
            const convertedMemo = inputNoteToUse.memo ? toBigInt(inputNoteToUse.memo) : 0n;
            
            const inputNoteObj = {
                amount: convertedAmount,
                tokenId: convertedTokenId,
                ownerCipherPayPubKey: toBigInt(inputNoteToUse.ownerCipherPayPubKey),
                randomness: {
                    r: convertedRandomnessR,
                    s: inputNoteToUse.randomness.s ? toBigInt(inputNoteToUse.randomness.s) : undefined,
                },
                memo: convertedMemo,
            };
            
            // Compute nullifier from input note (for storing with transfer messages)
            const { poseidonHash } = window.CipherPaySDK || {};
            if (!poseidonHash) {
                throw new Error('SDK poseidonHash not available');
            }
            const inputNullifier = await poseidonHash([
                inputNoteObj.ownerCipherPayPubKey,
                convertedRandomnessR,
                convertedTokenId
            ]);
            const inputNullifierHex = inputNullifier.toString(16).padStart(64, '0');
            
            // Compute sender's ownerCipherPayPubKey from wallet keys (for sender_key field)
            const ownerWalletPubKey = identity.ownerWalletPubKey || BigInt(0);
            const ownerWalletPrivKey = identity.ownerWalletPrivKey || BigInt(0);
            const senderOwnerCipherPayPubKey = await poseidonHash([ownerWalletPubKey, ownerWalletPrivKey]);
            const senderKey = '0x' + senderOwnerCipherPayPubKey.toString(16).padStart(64, '0');
            
            // Determine recipient for each output
            // For full transfer: both outputs go to recipient
            // For partial transfer: out1 goes to recipient, out2 goes to sender (change)
            const isFullTransfer = transferAmount === inputAmount;
            const out1Recipient = isFullTransfer 
                ? recipientCipherPayPubKey  // Full transfer: both to recipient
                : (recipientGetsOut1 ? recipientCipherPayPubKey : BigInt(inputNoteToUse.ownerCipherPayPubKey));
            const out2Recipient = isFullTransfer
                ? recipientCipherPayPubKey  // Full transfer: both to recipient
                : (recipientGetsOut1 ? BigInt(inputNoteToUse.ownerCipherPayPubKey) : recipientCipherPayPubKey);
            
            // Capture contentHashes for proof storage after transfer succeeds
            const transferContentHashes = [];

            const transferParams = {
                identity,
                inputNote: inputNoteObj,
                out1: {
                    amount: { atoms: out1Amount, decimals: 9 },
                    recipientCipherPayPubKey: out1Recipient,
                    token: tokenDescriptor,
                    memo: 0n,
                },
                out2: {
                    amount: { atoms: out2Amount, decimals: 9 },
                    recipientCipherPayPubKey: out2Recipient,
                    token: tokenDescriptor,
                    memo: 0n,
                },
                serverUrl,
                authToken,
                ownerWalletPubKey: identity.ownerWalletPubKey || BigInt(0),
                ownerWalletPrivKey: identity.ownerWalletPrivKey || BigInt(0),
                onOut1NoteReady: async (note) => {
                    try {
                        const hasNoteTokenId = 'tokenId' in note && note.tokenId !== undefined && note.tokenId !== null;
                        const tokenIdForCommitment = hasNoteTokenId ? note.tokenId : convertedTokenId;
                        const memoForCommitment = note.memo || 0n;
                        
                        // Verify that note.ownerCipherPayPubKey matches the expected recipient
                        const noteOwnerKey = '0x' + note.ownerCipherPayPubKey.toString(16).padStart(64, '0');
                        const expectedRecipientKey = '0x' + recipientCipherPayPubKey.toString(16).padStart(64, '0');
                        
                        if (noteOwnerKey !== expectedRecipientKey) {
                            console.error('[CipherPayService] WARNING: Out1 note ownerCipherPayPubKey does not match expected recipient!', {
                                noteOwnerKey,
                                expectedRecipientKey,
                            });
                            // Continue anyway - might be a full transfer where both outputs go to recipient
                        }
                        
                        // Get recipient's Curve25519 encryption public key from DB (SECURE approach)
                        // This is a Curve25519 public key (base64), derived from wallet signature seed
                        // The seed is never stored - only this public key is stored
                        const recipientOwnerKey = '0x' + note.ownerCipherPayPubKey.toString(16).padStart(64, '0');
                        const recipientNoteEncPubKey = await getRecipientNoteEncPubKey(recipientOwnerKey);
                        if (!recipientNoteEncPubKey) {
                            const errorMsg = `Failed to get note_enc_pub_key for recipient ${recipientOwnerKey}. Recipient may not be registered yet.`;
                            console.error('[CipherPayService]', errorMsg);
                            throw new Error(errorMsg);
                        }
                        // Use Curve25519 public key directly (no derivation needed - it's already a Curve25519 key)
                        // This public key was derived from wallet signature seed and stored in DB
                        // Recipient will derive the matching keypair from their wallet signature seed when decrypting
                        const recipientEncPubKeyB64 = recipientNoteEncPubKey; // Already base64 Curve25519 public key
                        // Note: amount is stored in top-level message.amount field, not in ciphertext
                        const noteData = {
                            note: {
                                amount: '0x' + note.amount.toString(16),
                                tokenId: '0x' + (note.tokenId !== undefined && note.tokenId !== null ? note.tokenId : convertedTokenId).toString(16),
                                ownerCipherPayPubKey: '0x' + note.ownerCipherPayPubKey.toString(16).padStart(64, '0'),
                                randomness: {
                                    r: '0x' + note.randomness.r.toString(16).padStart(64, '0'),
                                    ...(note.randomness.s ? { s: '0x' + note.randomness.s.toString(16).padStart(64, '0') } : {}),
                                },
                                ...(note.memo ? { memo: '0x' + note.memo.toString(16) } : {}),
                            },
                        };
                        const ciphertextB64 = encryptForRecipient(recipientEncPubKeyB64, noteData);
                        
                        // Generate audit receipt for sender if this is a payment note (not change)
                        // Audit receipt contains note preimage needed for audit proof generation
                        // Check if out1 is a change note (only in partial transfers where recipient doesn't get out1)
                        const isOut1ChangeNote = !isFullTransfer && (note.ownerCipherPayPubKey === BigInt(inputNoteToUse.ownerCipherPayPubKey));
                        console.log('[CipherPayService] Out1 note check - isFullTransfer:', isFullTransfer, 'isOut1ChangeNote:', isOut1ChangeNote, 'note.ownerCipherPayPubKey:', note.ownerCipherPayPubKey.toString(), 'inputNote.ownerCipherPayPubKey:', inputNoteToUse.ownerCipherPayPubKey);
                        let ciphertextAuditB64 = null;
                        if (!isOut1ChangeNote) {
                            // Only generate audit receipt for payment notes (not change notes)
                            console.log('[CipherPayService] Generating audit receipt for out1 (payment note)');
                            try {
                            // Compute commitment if SDK is available, otherwise leave it optional
                            let commitment = null;
                            // Get tokenId from note, or fall back to input note's tokenId if missing
                            // The SDK's note object might not always include tokenId
                            // Check if tokenId exists (including BigInt 0n which is a valid value)
                            const hasNoteTokenId = 'tokenId' in note && note.tokenId !== undefined && note.tokenId !== null;
                            const tokenIdForAudit = hasNoteTokenId ? note.tokenId : convertedTokenId;
                            
                            if (this.sdk && typeof this.sdk.commitmentOf === 'function') {
                                try {
                                    commitment = await this.sdk.commitmentOf({
                                        amount: note.amount,
                                        tokenId: tokenIdForAudit,
                                        ownerCipherPayPubKey: note.ownerCipherPayPubKey,
                                        randomness: note.randomness,
                                        memo: note.memo || 0n
                                    });
                                    
                                } catch (e) {
                                    console.warn('[CipherPayService] Failed to compute commitment for audit receipt:', e);
                                }
                            }
                            
                            // Validate tokenId exists
                            if (tokenIdForAudit === undefined || tokenIdForAudit === null) {
                                console.error('[CipherPayService] ERROR: tokenId is missing!', { 
                                    note: {
                                        hasTokenId: 'tokenId' in note,
                                        tokenId: note.tokenId,
                                        tokenIdType: typeof note.tokenId,
                                        allKeys: Object.keys(note)
                                    }, 
                                    convertedTokenId,
                                    convertedTokenIdType: typeof convertedTokenId
                                });
                                throw new Error('tokenId is required for audit receipt but is missing');
                            }
                            
                            // Ensure tokenIdForAudit is a BigInt before calling toString
                            const finalTokenId = typeof tokenIdForAudit === 'bigint' 
                                ? tokenIdForAudit 
                                : BigInt(tokenIdForAudit);
                            
                            // Create audit receipt object
                            const randomnessRHex = '0x' + note.randomness.r.toString(16).padStart(64, '0');
                            const auditReceipt = {
                                amount: '0x' + note.amount.toString(16),
                                tokenId: '0x' + finalTokenId.toString(16),
                                memo: note.memo ? '0x' + note.memo.toString(16) : '0x0',
                                randomness: {
                                    r: randomnessRHex,
                                    ...(note.randomness.s ? { s: '0x' + note.randomness.s.toString(16).padStart(64, '0') } : {}),
                                },
                                cipherPayPubKey: '0x' + note.ownerCipherPayPubKey.toString(16).padStart(64, '0'),
                                ...(commitment ? { commitment: '0x' + commitment.toString(16).padStart(64, '0') } : {}),
                            };
                            
                            // Encrypt audit receipt for sender using sender's own encryption public key
                            const senderEncPubKeyB64 = getLocalEncPublicKeyB64();
                            ciphertextAuditB64 = encryptForSender(senderEncPubKeyB64, auditReceipt);
                            } catch (error) {
                                console.error('[CipherPayService] ❌ Failed to generate audit receipt for out1 (non-fatal):', error);
                                console.error('[CipherPayService] Error details:', {
                                    message: error.message,
                                    stack: error.stack,
                                    note: {
                                        hasTokenId: 'tokenId' in note,
                                        tokenId: note.tokenId,
                                        tokenIdType: typeof note.tokenId
                                    },
                                    convertedTokenId
                                });
                                // Continue without audit receipt - it's optional for backward compatibility
                            }
                        } else {
                            console.log('[CipherPayService] Skipping audit receipt for out1 note (change note for sender)');
                        }
                        
                        const recipientKey = '0x' + note.ownerCipherPayPubKey.toString(16).padStart(64, '0');
                        const messageResponse = await fetch(`${serverUrl}/api/v1/messages`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
                            },
                            body: JSON.stringify({
                                recipientKey,
                                senderKey: senderKey, // Sender's ownerCipherPayPubKey (person making the transfer)
                                ciphertextB64,
                                ...(ciphertextAuditB64 ? { ciphertextAuditB64 } : {}), // Include audit receipt if generated
                                kind: 'note-transfer',
                                nullifierHex: inputNullifierHex, // Store input note's nullifier with both output messages
                                amount: note.amount.toString(), // Store amount unencrypted for easy access
                            }),
                        });
                        if (messageResponse.ok) {
                            const messageResult = await messageResponse.json();
                            if (messageResult.contentHash) transferContentHashes.push(messageResult.contentHash);
                        } else {
                            const errorText = await messageResponse.text();
                            console.error('[CipherPayService] ❌ Failed to save out1 note message:', messageResponse.status, errorText);
                            console.error('[CipherPayService] Out1 message details:', {
                                recipientKey,
                                kind: 'note-transfer',
                                ciphertextLength: ciphertextB64.length,
                            });
                        }
                    } catch (error) {
                        console.error('[CipherPayService] ❌ Exception while saving encrypted out1 note message:', error);
                        console.error('[CipherPayService] Error stack:', error.stack);
                        // Don't throw - let the transfer continue even if message saving fails
                    }
                },
                onOut2NoteReady: async (note) => {
                    // Skip saving note if amount is 0 (should not happen, but defensive check)
                    if (note.amount === 0n || note.amount === 0) {
                        console.log('[CipherPayService] Out2 note has 0 amount, skipping save');
                        return;
                    }
                    
                    try {
                        // For full transfer: out2 is for recipient (part of random split)
                        // For partial transfer: out2 is change for sender
                        // Determine the actual recipient of this specific output note
                        // If it's a change note for the sender, use the sender's encryption public key
                        // Otherwise, use the recipient's encryption public key (from DB)
                        const isChangeNoteForSender = !isFullTransfer && (note.ownerCipherPayPubKey === BigInt(inputNoteToUse.ownerCipherPayPubKey));
                        let encryptionTargetPubKey;
                        if (isChangeNoteForSender) {
                            // Sender's own encryption key (derived from their privKey)
                            encryptionTargetPubKey = getLocalEncPublicKeyB64();
                        } else {
                            // Get recipient's Curve25519 encryption public key from DB (SECURE approach)
                            const recipientOwnerKey = '0x' + note.ownerCipherPayPubKey.toString(16).padStart(64, '0');
                            const recipientNoteEncPubKey = await getRecipientNoteEncPubKey(recipientOwnerKey);
                            if (!recipientNoteEncPubKey) {
                                throw new Error(`Failed to get note_enc_pub_key for recipient ${recipientOwnerKey}`);
                            }
                            // Use Curve25519 public key directly (no derivation needed - it's already a Curve25519 key)
                            encryptionTargetPubKey = recipientNoteEncPubKey;
                        }
                        // Note: amount is stored in top-level message.amount field, not in ciphertext
                        const noteData = {
                            note: {
                                amount: '0x' + note.amount.toString(16),
                                tokenId: '0x' + (note.tokenId !== undefined && note.tokenId !== null ? note.tokenId : convertedTokenId).toString(16),
                                ownerCipherPayPubKey: '0x' + note.ownerCipherPayPubKey.toString(16).padStart(64, '0'),
                                randomness: {
                                    r: '0x' + note.randomness.r.toString(16).padStart(64, '0'),
                                    ...(note.randomness.s ? { s: '0x' + note.randomness.s.toString(16).padStart(64, '0') } : {}),
                                },
                                ...(note.memo ? { memo: '0x' + note.memo.toString(16) } : {}),
                            },
                        };
                        const ciphertextB64 = encryptForRecipient(encryptionTargetPubKey, noteData);
                        
                        // Generate audit receipt for sender if this is a payment note (not change)
                        // Audit receipt contains note preimage needed for audit proof generation
                        let ciphertextAuditB64 = null;
                        if (!isChangeNoteForSender) {
                            // Only generate audit receipt for payment notes (not change notes)
                            try {
                                // Get tokenId from note, or fall back to input note's tokenId if missing
                                // The SDK's note object might not always include tokenId
                                // Check if tokenId exists (including BigInt 0n which is a valid value)
                                const hasNoteTokenId = 'tokenId' in note && note.tokenId !== undefined && note.tokenId !== null;
                                const tokenIdForAudit = hasNoteTokenId ? note.tokenId : convertedTokenId;
                                
                                
                                // Compute commitment if SDK is available, otherwise leave it optional
                                let commitment = null;
                                if (this.sdk && typeof this.sdk.commitmentOf === 'function') {
                                    try {
                                        commitment = await this.sdk.commitmentOf({
                                            amount: note.amount,
                                            tokenId: tokenIdForAudit,
                                            ownerCipherPayPubKey: note.ownerCipherPayPubKey,
                                            randomness: note.randomness,
                                            memo: note.memo || 0n
                                        });
                                    } catch (e) {
                                        console.warn('[CipherPayService] Failed to compute commitment for audit receipt:', e);
                                    }
                                }
                                
                                if (tokenIdForAudit === undefined || tokenIdForAudit === null) {
                                    console.error('[CipherPayService] ERROR: tokenId is missing!', { 
                                        note: {
                                            hasTokenId: 'tokenId' in note,
                                            tokenId: note.tokenId,
                                            tokenIdType: typeof note.tokenId,
                                            allKeys: Object.keys(note)
                                        }, 
                                        convertedTokenId,
                                        convertedTokenIdType: typeof convertedTokenId
                                    });
                                    throw new Error('tokenId is required for audit receipt but is missing');
                                }
                                
                                // Ensure tokenIdForAudit is a BigInt before calling toString
                                const finalTokenId = typeof tokenIdForAudit === 'bigint' 
                                    ? tokenIdForAudit 
                                    : BigInt(tokenIdForAudit);
                                
                                // Create audit receipt object
                                const auditReceipt = {
                                    amount: '0x' + note.amount.toString(16),
                                    tokenId: '0x' + finalTokenId.toString(16),
                                    memo: note.memo ? '0x' + note.memo.toString(16) : '0x0',
                                    randomness: {
                                        r: '0x' + note.randomness.r.toString(16).padStart(64, '0'),
                                        ...(note.randomness.s ? { s: '0x' + note.randomness.s.toString(16).padStart(64, '0') } : {}),
                                    },
                                    cipherPayPubKey: '0x' + note.ownerCipherPayPubKey.toString(16).padStart(64, '0'),
                                    ...(commitment ? { commitment: '0x' + commitment.toString(16).padStart(64, '0') } : {}),
                                };
                                
                                // Encrypt audit receipt for sender using sender's own encryption public key
                                const senderEncPubKeyB64 = getLocalEncPublicKeyB64();
                                ciphertextAuditB64 = encryptForSender(senderEncPubKeyB64, auditReceipt);
                            } catch (error) {
                                console.error('[CipherPayService] ❌ Failed to generate audit receipt for out2 (non-fatal):', error);
                                console.error('[CipherPayService] Error details:', {
                                    message: error.message,
                                    stack: error.stack,
                                    note: {
                                        hasTokenId: 'tokenId' in note,
                                        tokenId: note.tokenId,
                                        tokenIdType: typeof note.tokenId
                                    },
                                    convertedTokenId
                                });
                                // Continue without audit receipt - it's optional for backward compatibility
                            }
                        } else {
                            console.log('[CipherPayService] Skipping audit receipt for out2 note (change note for sender)');
                        }
                        
                        const recipientKey = '0x' + note.ownerCipherPayPubKey.toString(16).padStart(64, '0');
                        const messageResponse = await fetch(`${serverUrl}/api/v1/messages`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
                            },
                            body: JSON.stringify({
                                recipientKey,
                                senderKey: senderKey, // Sender's ownerCipherPayPubKey (person making the transfer)
                                ciphertextB64,
                                ...(ciphertextAuditB64 ? { ciphertextAuditB64 } : {}), // Include audit receipt if generated
                                kind: 'note-transfer',
                                nullifierHex: inputNullifierHex, // Store input note's nullifier with both output messages
                                amount: note.amount.toString(), // Store amount unencrypted for easy access
                            }),
                        });
                        if (messageResponse.ok) {
                            const messageResult = await messageResponse.json();
                            if (messageResult.contentHash) transferContentHashes.push(messageResult.contentHash);
                        } else {
                            const errorText = await messageResponse.text();
                            console.warn('[CipherPayService] Failed to save out2 note message:', errorText);
                        }
                    } catch (error) {
                        console.warn('[CipherPayService] Failed to save encrypted out2 note message:', error);
                    }
                },
            };

            // Call SDK transfer
            const result = await window.CipherPaySDK.transfer(transferParams);

            // Store proof on both output messages after successful transfer
            if (result.proofHex && result.proofPublicSignals && transferContentHashes.length > 0) {
                const patchPromises = transferContentHashes.map((contentHash) =>
                    fetch(`${serverUrl}/api/v1/messages/${contentHash}/proof`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
                        },
                        body: JSON.stringify({
                            proofHex: result.proofHex,
                            proofPublicSignals: result.proofPublicSignals,
                        }),
                    })
                );
                try {
                    await Promise.all(patchPromises);
                    console.log('[CipherPayService] Stored proof on transfer messages');
                } catch (e) {
                    console.warn('[CipherPayService] Failed to store proof on messages:', e);
                }
            }


            // Note: We don't need to create a separate "note-transfer-sent" message.
            // The backend will determine "sent" vs "change" by comparing recipient_key to owner:
            // - If recipient_key === owner → it's the change
            // - If recipient_key !== owner → it's the sent transfer
            // Both messages are already created above (out1 and out2).

            return {
                recipient: recipientPublicKey,
                amount: amount,
                changeAmount: changeAmount,
                timestamp: Date.now(),
                id: result.txId || result.signature,
                txHash: result.txId || result.signature,
                out1Commitment: result.out1Commitment?.toString(),
                out2Commitment: result.out2Commitment?.toString(),
                nullifier: result.nullifier?.toString(),
            };
        } catch (error) {
            console.error('[CipherPayService] Failed to execute single transfer:', error);
            throw error;
        }
    }

    async sendTransaction(transaction) {
        if (!this.isInitialized) await this.initialize();

        try {
            // The transaction is already sent when created via SDK transfer
            // This method is kept for compatibility with the UI
            // Return the transaction details as receipt
            return {
                txHash: transaction.id || transaction.txHash,
                status: 'success',
                signature: transaction.id || transaction.txHash,
                out1Commitment: transaction.out1Commitment,
                out2Commitment: transaction.out2Commitment,
                nullifier: transaction.nullifier
            };
        } catch (error) {
            console.error('Failed to send transaction:', error);
            throw error;
        }
    }

    async checkTransactionStatus(txHash) {
        if (!this.isInitialized) await this.initialize();

        try {
            return await this.sdk.relayerClient.checkTxStatus(txHash);
        } catch (error) {
            console.error('Failed to check transaction status:', error);
            throw error;
        }
    }

    // Delegate Approval (One-time setup before deposits)
    async approveRelayerDelegate(params) {
        try {
            console.log('[CipherPayService] approveRelayerDelegate called with params:', params);
            
            // Validate required parameters
            if (!params.connection) throw new Error('Solana connection is required');
            if (!params.wallet) throw new Error('Wallet is required');
            if (!params.tokenMint) throw new Error('Token mint address is required');
            if (!params.amount) throw new Error('Amount is required');
            
            // Check if SDK function is available
            if (!window.CipherPaySDK?.approveRelayerDelegate) {
                throw new Error('SDK approveRelayerDelegate function not available. Ensure the SDK bundle is loaded.');
            }

            // Get relayer public key via server proxy (server reaches relayer at localhost; browser cannot)
            const serverUrl = getServerBaseUrl();
            const response = await fetch(`${serverUrl}/api/relayer/info`);
            if (!response.ok) {
                throw new Error(`Failed to get relayer info: ${response.status}`);
            }
            const info = await response.json();
            const relayerPubkey = info?.relayerPubkey ?? info?.relayerPubKey;
            if (!relayerPubkey) {
                throw new Error('Relayer info missing relayerPubkey');
            }
            console.log('[CipherPayService] Relayer pubkey:', relayerPubkey);

            // Import PublicKey
            const { PublicKey } = await import('@solana/web3.js');

            // Call SDK approveRelayerDelegate
            const result = await window.CipherPaySDK.approveRelayerDelegate({
                connection: params.connection,
                wallet: params.wallet,
                tokenMint: new PublicKey(params.tokenMint),
                relayerPubkey: new PublicKey(relayerPubkey),
                amount: BigInt(params.amount),
            });
            
            console.log('[CipherPayService] Delegate approval completed:', result);
            
            return {
                signature: result.signature,
                userTokenAccount: result.userTokenAccount.toBase58(),
            };
        } catch (error) {
            console.error('[CipherPayService] Failed to approve relayer delegate:', error);
            throw error;
        }
    }

    /**
     * Check if the relayer is already approved as delegate for the user's wSOL token account.
     * Reads on-chain state so we don't prompt for approval on every login.
     * Uses manual buffer parsing to avoid spl-token getAccount BigInt conversion issues.
     * @param {{ connection: Connection, walletPublicKey: string, tokenMint?: string }} params
     * @returns {Promise<boolean>}
     */
    async checkRelayerDelegateApproved(params) {
        try {
            const { connection, walletPublicKey, tokenMint = 'So11111111111111111111111111111111111111112' } = params;
            if (!connection || !walletPublicKey) return false;

            const { PublicKey } = await import('@solana/web3.js');
            const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');

            // Use server proxy for relayer info (server reaches relayer at localhost; browser cannot)
            const serverUrl = getServerBaseUrl();
            const response = await fetch(`${serverUrl}/api/relayer/info`);
            if (!response.ok) return false;
            const info = await response.json();
            const relayerPubkey = info?.relayerPubkey ?? info?.relayerPubKey;
            if (!relayerPubkey) {
                console.warn('[CipherPayService] checkRelayerDelegateApproved: relayer info missing relayerPubkey');
                return false;
            }
            console.log('[CipherPayService] checkRelayerDelegateApproved: relayer pubkey =', relayerPubkey);
            const relayerPubKey = new PublicKey(relayerPubkey);

            const userAta = getAssociatedTokenAddressSync(
                new PublicKey(tokenMint),
                new PublicKey(walletPublicKey)
            );
            const accountInfo = await connection.getAccountInfo(userAta);
            if (!accountInfo || !accountInfo.data) return false;

            const data = accountInfo.data;
            if (data.length < 129) return false;

            // SPL Token account layout: delegate COption at 72 (4 byte flag + 32 byte pubkey)
            // delegated_amount u64 at 121 (8 bytes)
            const delegateOption = data.readUInt32LE(72);
            if (delegateOption !== 1) return false;

            const delegateBytes = new Uint8Array(data.buffer, data.byteOffset + 76, 32);
            const relayerBytes = relayerPubKey.toBytes();
            const delegateMatches = delegateBytes.length === relayerBytes.length &&
                delegateBytes.every((b, i) => b === relayerBytes[i]);

            if (!delegateMatches) return false;

            const view = new DataView(data.buffer, data.byteOffset + 121, 8);
            const delegatedAmount = view.getBigUint64(0, true);
            return delegatedAmount > 0n;
        } catch (err) {
            console.warn('[CipherPayService] checkRelayerDelegateApproved failed:', err?.message || err);
            return false;
        }
    }

    // Deposit Management
    async createDeposit(params) {
        if (!this.isInitialized) await this.initialize();

        try {
            console.log('[CipherPayService] createDeposit called with params:', params);
            
            // Validate required parameters
            if (!params.amount) throw new Error('Amount is required');
            if (!params.tokenMint) throw new Error('Token mint address is required');
            
            // Check if SDK deposit function is available
            if (!window.CipherPaySDK?.deposit) {
                throw new Error('SDK deposit function not available. Ensure the SDK bundle is loaded.');
            }

            // Get identity from stored keys (created during authentication)
            const identity = await this.getIdentity();
            if (!identity) {
                throw new Error('Identity not found. Please authenticate first.');
            }

            // Get auth token for server API calls
            const authToken = localStorage.getItem('cipherpay_token');

            // Prepare token descriptor
            const tokenDescriptor = {
                chain: 'solana',
                symbol: params.tokenSymbol || 'UNKNOWN',
                decimals: params.decimals || 9,
                solana: {
                    mint: params.tokenMint,
                    decimals: params.decimals || 9,
                }
            };

            // Get server URL (cipherpay-server, NOT relayer)
            const serverUrl = getServerBaseUrl();

            // Prepare deposit parameters for SDK
            const depositParams = {
                identity,
                token: tokenDescriptor,
                amount: {
                    atoms: BigInt(params.amount),
                    decimals: params.decimals || 9,
                },
                memo: params.memo ? BigInt(params.memo) : 0n,
                serverUrl,  // UI → Server → Relayer flow
                authToken,
                ownerWalletPubKey: identity.ownerWalletPubKey || BigInt(0),
                ownerWalletPrivKey: identity.ownerWalletPrivKey || BigInt(0),
                nonce: BigInt(Date.now() % 1000000), // Simple nonce for now
                // Delegate mode parameters
                sourceOwner: params.sourceOwner,
                sourceTokenAccount: params.sourceTokenAccount,
                useDelegate: params.useDelegate,
            };

            // Capture contentHash for proof storage after deposit succeeds
            let depositContentHash = null;

            // Callback to save encrypted note during prepare phase
            const onNoteReady = async (note) => {
                try {
                    console.log('[CipherPayService] Note ready, encrypting and saving...', note);
                    
                    // Get encryption public key (will validate and recreate if corrupted)
                    const recipientEncPubKeyB64 = getLocalEncPublicKeyB64();
                    
                    // Use commitment from SDK if provided, otherwise compute it
                    // The SDK passes the commitment in the note object, so use that to avoid any mismatch
                    let commitmentHex;
                    if (note.commitment !== undefined && note.commitment !== null) {
                        // Use SDK-provided commitment (most reliable)
                        commitmentHex = note.commitment.toString(16).padStart(64, '0');
                    } else {
                        // Fallback: compute commitment ourselves (for backward compatibility)
                        const { poseidonHash } = window.CipherPaySDK || {};
                        if (!poseidonHash) {
                            throw new Error('SDK poseidonHash not available');
                        }
                        const commitment = await poseidonHash([
                            note.amount,
                            note.ownerCipherPayPubKey,
                            note.randomness.r,
                            note.tokenId,
                            note.memo || 0n
                        ]);
                        commitmentHex = commitment.toString(16).padStart(64, '0');
                    }
                    
                    // Format note data as hex strings (with 0x prefix) for consistency with decrypt function
                    // Note: amount is stored in top-level message.amount field, not in ciphertext
                    const noteData = {
                        note: {
                            amount: '0x' + note.amount.toString(16),
                            tokenId: '0x' + note.tokenId.toString(16),
                            ownerCipherPayPubKey: '0x' + note.ownerCipherPayPubKey.toString(16).padStart(64, '0'),
                            randomness: {
                                r: '0x' + note.randomness.r.toString(16).padStart(64, '0'),
                                ...(note.randomness.s ? { s: '0x' + note.randomness.s.toString(16).padStart(64, '0') } : {}),
                            },
                            ...(note.memo ? { memo: '0x' + note.memo.toString(16) } : {}),
                        },
                    };
                    
                    console.log('[CipherPayService] Encrypting note data...');
                    const ciphertextB64 = encryptForRecipient(recipientEncPubKeyB64, noteData);
                    console.log('[CipherPayService] Encryption successful, ciphertext length:', ciphertextB64.length);
                    const recipientKey = '0x' + note.ownerCipherPayPubKey.toString(16).padStart(64, '0');
                    
                    // Send encrypted message to backend with commitment_hex (stored in nullifier_hex field)
                    const serverUrl = getServerBaseUrl();
                    const messageResponse = await fetch(`${serverUrl}/api/v1/messages`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
                        },
                        body: JSON.stringify({
                            recipientKey,
                            ciphertextB64,
                            kind: 'note-deposit',
                            nullifierHex: commitmentHex, // Store commitment in nullifier_hex field for consistency
                            amount: note.amount.toString(), // Store amount unencrypted for easy access
                        }),
                    });
                    
                    if (messageResponse.ok) {
                        const messageResult = await messageResponse.json();
                        depositContentHash = messageResult.contentHash;
                        console.log('[CipherPayService] Saved encrypted note message during prepare:', messageResult);
                    } else {
                        const errorText = await messageResponse.text();
                        console.warn('[CipherPayService] Failed to save note message:', errorText);
                        // Don't throw - deposit can continue even if message save fails
                    }
                } catch (error) {
                    console.warn('[CipherPayService] Failed to save encrypted note message:', error);
                    // Don't throw - deposit can continue even if message save fails
                }
            };

            console.log('[CipherPayService] Calling SDK deposit with params:', {
                ...depositParams,
                authToken: authToken ? '***' : null,
            });

            // Add callback to save note during prepare
            depositParams.onNoteReady = onNoteReady;

            // Call SDK deposit function (now calls server APIs)
            const result = await window.CipherPaySDK.deposit(depositParams);
            
            console.log('[CipherPayService] Deposit completed:', result);

            // Store proof on message after successful deposit
            if (depositContentHash && result.proofHex && result.proofPublicSignals) {
                try {
                    const patchRes = await fetch(`${serverUrl}/api/v1/messages/${depositContentHash}/proof`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
                        },
                        body: JSON.stringify({
                            proofHex: result.proofHex,
                            proofPublicSignals: result.proofPublicSignals,
                        }),
                    });
                    if (patchRes.ok) {
                        console.log('[CipherPayService] Stored proof on deposit message');
                    } else {
                        console.warn('[CipherPayService] Failed to store proof on message:', await patchRes.text());
                    }
                } catch (e) {
                    console.warn('[CipherPayService] Failed to store proof:', e);
                }
            }
            
            return {
                txHash: result.signature || result.txId,
                commitment: result.commitment?.toString(),
                merkleRoot: result.merkleRoot?.toString(),
                index: result.index,
            };
        } catch (error) {
            console.error('[CipherPayService] Failed to create deposit:', error);
            throw error;
        }
    }

    // Helper to get identity from stored keys
    async getIdentity() {
        try {
            // Try to get identity from authService or localStorage
            const storedIdentity = localStorage.getItem('cipherpay_identity');
            if (storedIdentity) {
                const parsed = JSON.parse(storedIdentity);
                
                // Helper to convert stored values to BigInt
                const toBigInt = (val) => {
                    if (!val) return BigInt(0);
                    if (typeof val === 'bigint') return val;
                    if (typeof val === 'string' && /^-?\d+$/.test(val) && val.length > 15) {
                        return BigInt(val);
                    }
                    if (typeof val === 'string' && /^\d+(,\d+)+$/.test(val)) {
                        // Convert comma-separated bytes to hex then BigInt
                        const nums = val.split(',').map(x => parseInt(x, 10));
                        const hex = nums.map(b => b.toString(16).padStart(2, '0')).join('');
                        return BigInt('0x' + hex);
                    }
                    return BigInt(val);
                };
                
                // Extract keypair from stored identity
                const keypair = parsed.keypair || {};
                const ownerWalletPubKey = toBigInt(keypair.pubKey);
                const ownerWalletPrivKey = toBigInt(keypair.privKey);
                
                // recipientCipherPayPubKey is derived from the keypair
                // For now, use pubKey as recipient (can be computed from Poseidon(pubKey, privKey) if needed)
                const recipientCipherPayPubKey = ownerWalletPubKey;
                
                console.log('[CipherPayService] Loaded identity with wallet keys:', {
                    ownerWalletPubKey: ownerWalletPubKey.toString().substring(0, 20) + '...',
                    ownerWalletPrivKey: ownerWalletPrivKey.toString().substring(0, 20) + '...',
                });
                
                return {
                    recipientCipherPayPubKey,
                    ownerWalletPubKey,
                    ownerWalletPrivKey,
                };
            }

            // Fallback: create a temporary identity (not ideal for production)
            console.warn('[CipherPayService] No stored identity found, using temporary identity');
            return {
                recipientCipherPayPubKey: BigInt(1),
                ownerWalletPubKey: BigInt(1),
                ownerWalletPrivKey: BigInt(1),
            };
        } catch (error) {
            console.error('[CipherPayService] Error getting identity:', error);
            return null;
        }
    }

    // Proof Management
    async generateProof(input) {
        if (!this.isInitialized) await this.initialize();

        try {
            const proof = await this.sdk.zkProver.generateTransferProof(input);
            return proof;
        } catch (error) {
            console.error('Failed to generate proof:', error);
            throw error;
        }
    }

    async verifyProof(proof, publicSignals, verifierKey) {
        if (!this.isInitialized) await this.initialize();

        try {
            return await this.sdk.zkProver.verifyProof(proof, publicSignals, verifierKey);
        } catch (error) {
            console.error('Failed to verify proof:', error);
            throw error;
        }
    }

    // View Key Management
    exportViewKey() {
        return this.sdk?.viewKeyManager?.exportViewKey() || null;
    }

    generateProofOfPayment(note) {
        return this.sdk?.viewKeyManager?.generateProofOfPayment(note) || null;
    }

    verifyProofOfPayment(proof, note, viewKey) {
        return this.sdk?.viewKeyManager?.verifyProofOfPayment(proof, note, viewKey) || false;
    }

    // Merkle Tree Operations
    async fetchMerkleRoot() {
        if (!this.isInitialized) await this.initialize();

        // Merkle tree client is often not available in browser SDK — callers should use backend fallback
        if (!this.sdk?.merkleTreeClient) {
            throw new Error('Merkle Tree Client is not available. It may not be initialized or may require additional configuration.');
        }
        return await this.sdk.merkleTreeClient.fetchMerkleRoot();
    }

    async getMerklePath(commitment) {
        if (!this.isInitialized) await this.initialize();

        try {
            // Check if merkleTreeClient is available
            if (!this.sdk?.merkleTreeClient) {
                throw new Error('Merkle Tree Client is not available. It may not be initialized or may require additional configuration.');
            }
            return await this.sdk.merkleTreeClient.getMerklePath(commitment);
        } catch (error) {
            console.error('Failed to get Merkle path:', error);
            throw error;
        }
    }

    // Withdrawal Management
    // New design: Always withdraw the full amount of a selected note
    // 1. Get spendable notes for selection (or auto-select if only one)
    // 2. Withdraw the full amount of the selected note
    
    /**
     * Get spendable notes for withdraw selection
     * Returns notes that can be withdrawn (amount >= 0.001 SOL)
     */
    async getWithdrawableNotes() {
        if (!this.isInitialized) await this.initialize();

        try {
            // Get spendable notes from backend database
            const spendable = await this.getSpendableNotes();
            if (spendable.length === 0) {
                return [];
            }

            // Filter out notes that are less than minimum withdraw amount
            const MIN_WITHDRAW_AMOUNT = 1_000_000n; // 0.001 SOL
            const validNotes = spendable.filter(n => BigInt(n.amount) >= MIN_WITHDRAW_AMOUNT);
            
            // Return notes with formatted amounts for display
            return validNotes.map(note => ({
                ...note,
                amountFormatted: (Number(note.amount) / 1e9).toFixed(9) + ' SOL',
                amountBigInt: BigInt(note.amount)
            }));
        } catch (error) {
            console.error('[CipherPayService] Failed to get withdrawable notes:', error);
            throw error;
        }
    }

    /**
     * Withdraw the full amount of a selected note
     * @param {Object} selectedNote - The note to withdraw (must have amount, tokenId, ownerCipherPayPubKey, randomness)
     * @param {string} recipientSolanaAddress - Solana wallet address to receive the funds
     */
    async withdraw(selectedNote, recipientSolanaAddress) {
        if (!this.isInitialized) await this.initialize();

        try {
            console.log('[CipherPayService] withdraw called with selected note:', {
                noteAmount: selectedNote.amount?.toString(),
                recipientSolanaAddress
            });

            // Validate required parameters
            if (!selectedNote) throw new Error('Note is required');
            if (!recipientSolanaAddress) throw new Error('Recipient Solana address is required');
            
            // Validate note structure
            if (!selectedNote.amount || !selectedNote.tokenId || !selectedNote.ownerCipherPayPubKey || !selectedNote.randomness) {
                throw new Error('Invalid note structure');
            }

            // Minimum withdraw amount: 0.001 SOL (1,000,000 atoms)
            const MIN_WITHDRAW_AMOUNT = 1_000_000n; // 0.001 SOL
            const noteAmount = BigInt(selectedNote.amount);
            if (noteAmount < MIN_WITHDRAW_AMOUNT) {
                throw new Error(`Note amount must be at least 0.001 SOL. Current: ${(Number(noteAmount) / 1e9).toFixed(9)} SOL`);
            }

            // Get identity from stored keys
            const identity = await this.getIdentity();
            if (!identity) {
                throw new Error('Identity not found. Please authenticate first.');
            }

            console.log('[CipherPayService] Withdrawing full amount of selected note:', {
                noteAmount: noteAmount.toString(),
                amountFormatted: (Number(noteAmount) / 1e9).toFixed(9) + ' SOL'
            });

            // Get wallet keys from identity
            const recipientWalletPubKey = identity.ownerWalletPubKey || BigInt(0);
            const recipientWalletPrivKey = identity.ownerWalletPrivKey || BigInt(0);

            // Compute commitment for the selected note
            const { poseidonHash } = window.CipherPaySDK || {};
            if (!poseidonHash) {
                throw new Error('SDK poseidonHash not available');
            }

            const recipientCipherPayPubKey = await poseidonHash([recipientWalletPubKey, recipientWalletPrivKey]);
            // noteAmount already declared above
            const tokenId = BigInt(selectedNote.tokenId);
            const randomnessValue = selectedNote.randomness;
            const randomness = BigInt(
                typeof randomnessValue === 'object' && randomnessValue !== null && randomnessValue.r !== undefined
                    ? randomnessValue.r
                    : randomnessValue
            );
            const memo = 0n; // Withdraw doesn't use memo

            // Compute commitment
            const commitment = await poseidonHash([
                noteAmount,
                recipientCipherPayPubKey,
                randomness,
                tokenId,
                memo
            ]);

            console.log('[CipherPayService] Computed commitment for withdraw:', commitment.toString(16));

            // Step 1: Prepare withdraw - get merkle path (use server proxy; browser cannot reach relayer at localhost)
            const serverUrl = getServerBaseUrl();
            const prepareAuthToken = localStorage.getItem('cipherpay_token');
            const prepareResponse = await fetch(`${serverUrl}/api/v1/prepare/withdraw`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(prepareAuthToken ? { 'Authorization': `Bearer ${prepareAuthToken}` } : {}),
                },
                body: JSON.stringify({
                    spendCommitment: commitment.toString(10)
                })
            });

            if (!prepareResponse.ok) {
                const errorText = await prepareResponse.text();
                let userMessage = `Failed to prepare withdraw (${prepareResponse.status})`;
                try {
                    const err = JSON.parse(errorText);
                    if (err?.message) userMessage = sanitizeErrorMessage(err.message);
                } catch { /* ignore parse errors */ }
                throw new Error(userMessage);
            }

            const prepareData = await prepareResponse.json();
            console.log('[CipherPayService] Withdraw prepare response:', {
                merkleRoot: prepareData.merkleRoot,
                leafIndex: prepareData.leafIndex,
                pathElementsCount: prepareData.pathElements?.length,
                pathIndicesCount: prepareData.pathIndices?.length
            });

            // Step 1.5: Create withdraw message during prepare phase (before proof generation)
            // This follows the same pattern as deposits and transfers
            // Capture contentHash for proof storage after withdraw succeeds
            let withdrawContentHash = null;

            const nullifier = await poseidonHash([
                recipientCipherPayPubKey,
                randomness,
                tokenId
            ]);
            const nullifierHex = nullifier.toString(16).padStart(64, '0');
            
            try {
                const serverUrl = getServerBaseUrl();
                const authToken = localStorage.getItem('cipherpay_token');
                
                // Get the user's encryption public key for encrypting the withdraw message
                const recipientEncPubKeyB64 = await getLocalEncPublicKeyB64();
                if (recipientEncPubKeyB64) {
                    // Create withdraw metadata (pending - will be updated when event is received)
                    // Note: amount is stored in top-level message.amount field, not in ciphertext
                    // IMPORTANT: Include full note structure with randomness to match deposit/transfer messages
                    // This ensures the account overview can compute the correct nullifier
                    const withdrawData = {
                        nullifier: nullifierHex,
                        recipientSolanaAddress: recipientSolanaAddress,
                        tokenId: tokenId.toString(),
                        txSignature: null, // Will be updated when WithdrawCompleted event is received
                        status: 'pending',
                        timestamp: new Date().toISOString(),
                        // Include full note structure for consistency with deposit/transfer messages
                        // This must match the exact note that was deposited/transferred
                        note: {
                            amount: '0x' + noteAmount.toString(16),
                            tokenId: '0x' + tokenId.toString(16),
                            ownerCipherPayPubKey: '0x' + recipientCipherPayPubKey.toString(16).padStart(64, '0'),
                            randomness: {
                                r: '0x' + randomness.toString(16).padStart(64, '0'),
                                // Note: withdraw doesn't use s randomness, but include it if present in selectedNote
                                ...(selectedNote.randomness?.s ? { s: '0x' + BigInt(selectedNote.randomness.s).toString(16).padStart(64, '0') } : {}),
                            },
                            ...(memo !== 0n ? { memo: '0x' + memo.toString(16) } : {}),
                        },
                    };
                    
                    // Encrypt the withdraw data
                    const ciphertextB64 = encryptForRecipient(recipientEncPubKeyB64, withdrawData);
                    
                    // Get the user's ownerCipherPayPubKey for recipient_key
                    const recipientKey = '0x' + recipientCipherPayPubKey.toString(16).padStart(64, '0');
                    
                    // Save the withdraw message with nullifier_hex for later lookup
                    const messageResponse = await fetch(`${serverUrl}/api/v1/messages`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
                        },
                        body: JSON.stringify({
                            recipientKey,
                            ciphertextB64,
                            kind: 'note-withdraw',
                            nullifierHex: nullifierHex,
                            amount: noteAmount.toString(), // Store amount unencrypted for easy access
                        }),
                    });
                    
                    if (messageResponse.ok) {
                        const messageResult = await messageResponse.json();
                        withdrawContentHash = messageResult.contentHash;
                        console.log('[CipherPayService] Saved withdraw message during prepare:', messageResult);
                    } else {
                        const errorText = await messageResponse.text();
                        console.warn('[CipherPayService] Failed to save withdraw message during prepare:', errorText);
                    }
                }
            } catch (error) {
                console.warn('[CipherPayService] Failed to create withdraw message during prepare:', error);
                // Don't throw - withdraw can continue even if message save fails
            }

            // Step 2: Split recipient Solana public key into 128-bit limbs
            // Convert base58 address to bytes, then split into two 16-byte LE integers
            const { PublicKey } = await import('@solana/web3.js');
            const recipientPubKey = new PublicKey(recipientSolanaAddress);
            const pubKeyBytes = recipientPubKey.toBytes(); // 32 bytes, big-endian/network order

            // Split into two 16-byte chunks and interpret each as little-endian
            function bigIntFromBytesLE(bytes) {
                let result = 0n;
                for (let i = 0; i < bytes.length; i++) {
                    result += BigInt(bytes[i]) << (8n * BigInt(i));
                }
                return result;
            }

            const loBytes = pubKeyBytes.slice(0, 16);
            const hiBytes = pubKeyBytes.slice(16, 32);
            const recipientOwner_lo = bigIntFromBytesLE(loBytes);
            const recipientOwner_hi = bigIntFromBytesLE(hiBytes);

            // Convert to hex32 for submission (32 hex chars = 16 bytes)
            const hex32 = (bi) => bi.toString(16).padStart(32, '0');
            const recipientOwner_lo_hex = hex32(recipientOwner_lo);
            const recipientOwner_hi_hex = hex32(recipientOwner_hi);

            console.log('[CipherPayService] Recipient owner limbs:', {
                lo_hex: recipientOwner_lo_hex,
                hi_hex: recipientOwner_hi_hex,
                lo_dec: recipientOwner_lo.toString(),
                hi_dec: recipientOwner_hi.toString()
            });

            // Step 3: Build circuit witness inputs
            const FQ = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
            const modF = (x) => ((x % FQ) + FQ) % FQ;

            // Convert path elements from hex (BE) to bigint
            const pathElements = prepareData.pathElements.map(hex => {
                // Convert BE hex to bigint
                const hexStr = hex.startsWith('0x') ? hex.slice(2) : hex;
                return modF(BigInt('0x' + hexStr));
            });

            const witnessInputs = {
                recipientOwner_lo: modF(recipientOwner_lo).toString(),
                recipientOwner_hi: modF(recipientOwner_hi).toString(),
                recipientWalletPubKey: modF(recipientWalletPubKey).toString(),
                recipientWalletPrivKey: modF(recipientWalletPrivKey).toString(),
                amount: modF(noteAmount).toString(),
                tokenId: modF(tokenId).toString(),
                randomness: modF(randomness).toString(),
                memo: modF(memo).toString(),
                pathElements: pathElements.map(p => p.toString()),
                pathIndices: prepareData.pathIndices,
                commitment: modF(commitment).toString()
            };

            console.log('[CipherPayService] Withdraw witness inputs prepared');

            // Step 4: Generate withdraw proof
            // Note: nullifier was already computed above for message creation

            // Try to generate proof using SDK's proof generation utilities
            // Check if SDK has withdraw proof generation capability
            let proof = null;
            let publicSignals = [];
            
            // Try to use SDK's zkProver if available
            if (this.sdk?.zkProver?.generateWithdrawProof) {
                try {
                    console.log('[CipherPayService] Generating withdraw proof using SDK zkProver...');
                    const proofResult = await this.sdk.zkProver.generateWithdrawProof(witnessInputs);
                    proof = proofResult.proof;
                    publicSignals = proofResult.publicSignals;
                    console.log('[CipherPayService] Withdraw proof generated successfully');
                } catch (proofError) {
                    console.error('[CipherPayService] Failed to generate proof using SDK zkProver:', proofError);
                    throw new Error(`Failed to generate withdraw proof: ${proofError.message}`);
                }
            } else {
                // SDK withdraw proof generation not available
                // For now, we need to implement this in the SDK or use a server endpoint
                throw new Error(
                    'Withdraw proof generation not yet implemented in SDK. ' +
                    'The SDK needs to implement generateWithdrawProof in zkProver. ' +
                    'Alternatively, a server endpoint can be created to generate proofs server-side.'
                );
            }

            // Step 5: Submit withdraw via server (proxies to relayer)
            const submitBody = {
                operation: 'withdraw',
                tokenMint: 'So11111111111111111111111111111111111111112', // wSOL mint
                proof: proof,
                publicSignals: publicSignals,
                nullifier: nullifier.toString(16).padStart(64, '0'),
                oldMerkleRoot: prepareData.merkleRoot,
                recipientWalletPubKey: recipientWalletPubKey.toString(16).padStart(64, '0'),
                amount: noteAmount.toString(),
                tokenId: tokenId.toString(),
                recipientOwner_lo: '0x' + recipientOwner_lo_hex,
                recipientOwner_hi: '0x' + recipientOwner_hi_hex,
                recipientOwner: recipientSolanaAddress,
                // recipientTokenAccount will be derived by relayer from recipientOwner
            };

            console.log('[CipherPayService] Submitting withdraw via server...');
            const authToken = localStorage.getItem('cipherpay_token');
            const submitResponse = await fetch(`${serverUrl}/api/v1/submit/withdraw`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
                },
                body: JSON.stringify(submitBody)
            });

            if (!submitResponse.ok) {
                const errorText = await submitResponse.text();
                let userMessage = `Failed to submit withdraw (${submitResponse.status})`;
                try {
                    const err = JSON.parse(errorText);
                    if (err?.message) userMessage = sanitizeErrorMessage(err.message);
                } catch { /* ignore parse errors */ }
                throw new Error(userMessage);
            }

            const submitResult = await submitResponse.json();
            console.log('[CipherPayService] Withdraw submitted successfully:', submitResult);

            // Store proof on withdraw message after successful submit
            if (withdrawContentHash && proof && publicSignals) {
                try {
                    const proofHex = window.CipherPaySDK?.groth16ProofToHex
                        ? window.CipherPaySDK.groth16ProofToHex(proof)
                        : null;
                    const proofPublicSignalsArr = Array.isArray(publicSignals)
                        ? publicSignals.map((s) => String(s))
                        : Object.values(publicSignals).map((s) => String(s));
                    if (proofHex) {
                        const authToken = localStorage.getItem('cipherpay_token');
                        const patchRes = await fetch(`${serverUrl}/api/v1/messages/${withdrawContentHash}/proof`, {
                            method: 'PATCH',
                            headers: {
                                'Content-Type': 'application/json',
                                ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
                            },
                            body: JSON.stringify({
                                proofHex,
                                proofPublicSignals: proofPublicSignalsArr,
                            }),
                        });
                        if (patchRes.ok) {
                            console.log('[CipherPayService] Stored proof on withdraw message');
                        } else {
                            console.warn('[CipherPayService] Failed to store proof on withdraw message:', await patchRes.text());
                        }
                    }
                } catch (e) {
                    console.warn('[CipherPayService] Failed to store withdraw proof:', e);
                }
            }

            return {
                txHash: submitResult.signature || submitResult.txid || submitResult.txSig || 'pending',
                signature: submitResult.signature || submitResult.txid || submitResult.txSig,
                success: submitResult.ok !== false
            };
        } catch (error) {
            console.error('[CipherPayService] Failed to withdraw:', error);
            throw error;
        }
    }


    // Compliance Management
    async generateComplianceReport(startTime, endTime) {
        if (!this.isInitialized) await this.initialize();

        try {
            return this.sdk.generateComplianceReport(startTime, endTime);
        } catch (error) {
            console.error('Failed to generate compliance report:', error);
            throw error;
        }
    }

    // Cache Management
    getCacheStats() {
        if (!this.isInitialized) return null;
        return this.sdk.getCacheStats();
    }

    // Utility Methods
    isConnected() {
        try {
            // Return true only if walletProvider exists and has a valid public address
            const address = this.getPublicAddress();
            return !!(this.sdk?.walletProvider && address && typeof address === 'string' && address.length > 0);
        } catch (error) {
            // Handle any errors gracefully
            return false;
        }
    }

    async getServiceStatus() {
        console.log('[CipherPayService] getServiceStatus called (should always log this!)');
        const allNotes = await this.getAllNotes();
        const publicAddress = this.getPublicAddress();
        const balance = this.getBalance();
        const isConnected = !!(this.sdk?.walletProvider && publicAddress && typeof publicAddress === 'string' && publicAddress.length > 0);
        const spendableNotes = await this.getSpendableNotes();
        console.log('[CipherPayService] getServiceStatus returning:', { isConnected, publicAddress, balance });
        return {
            isInitialized: this.isInitialized,
            isConnected,
            publicAddress: publicAddress || null,
            balance,
            spendableNotes: spendableNotes.length,
            totalNotes: allNotes.length,
            cacheStats: this.getCacheStats(),
            chainType: this.config.chainType
        };
    }

    // Account Overview from Backend (decrypts messages.ciphertext)
    async getAccountOverviewFromBackend(options = {}) {
        try {
            const overview = await fetchAccountOverview(options);
            return overview;
        } catch (error) {
            // Not authenticated is expected when user is not logged in — return empty overview
            if (error?.message?.includes('Not authenticated') || error?.message?.includes('authenticated')) {
                return { notes: [], shieldedBalance: 0n, spendableNotes: 0, totalNotes: 0 };
            }
            console.error('[CipherPayService] Failed to get account overview from backend:', error);
            throw error;
        }
    }

    async getMessagesFromBackend(options = {}) {
        try {
            return await fetchMessages(options);
        } catch (error) {
            console.error('[CipherPayService] Failed to fetch messages from backend:', error);
            throw error;
        }
    }

    async decryptMessagesFromBackend(messages) {
        try {
            return decryptMessages(messages);
        } catch (error) {
            console.error('[CipherPayService] Failed to decrypt messages:', error);
            throw error;
        }
    }

    async computeAccountOverviewFromNotes(notes, checkOnChain = false) {
        try {
            return await computeAccountOverview(notes, checkOnChain);
        } catch (error) {
            console.error('[CipherPayService] Failed to compute account overview:', error);
            throw error;
        }
    }

    // Event Handling
    addEventListener(eventType, callback) {
        if (!this.eventListeners[eventType]) {
            this.eventListeners[eventType] = [];
        }
        this.eventListeners[eventType].push(callback);
        console.log(`[CipherPayService] Event listener added for: ${eventType}`);
    }

    removeEventListener(eventType, callback) {
        if (!this.eventListeners[eventType]) return;
        this.eventListeners[eventType] = this.eventListeners[eventType].filter(cb => cb !== callback);
        console.log(`[CipherPayService] Event listener removed for: ${eventType}`);
    }

    emit(eventType, data) {
        console.log(`[CipherPayService] Emitting event: ${eventType}`, data);
        if (!this.eventListeners[eventType]) return;
        this.eventListeners[eventType].forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`[CipherPayService] Error in event listener for ${eventType}:`, error);
            }
        });
    }

    // Start event monitoring via Server SSE (not relayer API)
    async startEventMonitoring(recipientKey) {
        if (this.eventMonitoringActive) {
            console.log('[CipherPayService] Event monitoring already active');
            return;
        }

        if (!recipientKey) {
            console.warn('[CipherPayService] Cannot start event monitoring: recipientKey required');
            return;
        }

        console.log('[CipherPayService] Starting SSE event monitoring for:', recipientKey);
        this.eventMonitoringActive = true;

        try {
            const serverUrl = getServerBaseUrl();
            // EventSource doesn't support custom headers, so pass token as query param if needed
            const token = localStorage.getItem('cipherpay_token');
            const url = token 
                ? `${serverUrl}/stream?recipientKey=${recipientKey}&token=${encodeURIComponent(token)}`
                : `${serverUrl}/stream?recipientKey=${recipientKey}`;
            const eventSource = new EventSource(url);

            eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('[CipherPayService] SSE event received:', data);
                    
                    // Emit specific event types
                    if (data.type === 'DepositCompleted') {
                        console.log('[CipherPayService] Deposit completed event:', data);
                        this.emit('depositCompleted', data);
                    } else if (data.type === 'TransferCompleted') {
                        console.log('[CipherPayService] Transfer completed event:', data);
                        this.emit('transferCompleted', data);
                    } else if (data.type === 'WithdrawCompleted') {
                        console.log('[CipherPayService] Withdraw completed event:', data);
                        this.emit('withdrawCompleted', data);
                    }
                    
                    // Emit generic event for any listeners
                    this.emit('event', data);
                } catch (error) {
                    console.error('[CipherPayService] Error parsing SSE event:', error);
                }
            };

            eventSource.onerror = (error) => {
                console.error('[CipherPayService] SSE connection error:', error);
                if (eventSource.readyState === EventSource.CLOSED) {
                    console.log('[CipherPayService] SSE connection closed, stopping monitoring');
                    this.eventMonitoringActive = false;
                }
            };

            // Store reference to close later
            this.stopEventStream = () => {
                eventSource.close();
                console.log('[CipherPayService] SSE connection closed');
            };
            
            console.log('[CipherPayService] SSE event monitoring started successfully');
        } catch (error) {
            console.error('[CipherPayService] Failed to start SSE event monitoring:', error);
            this.eventMonitoringActive = false;
        }
    }

    stopEventMonitoring() {
        if (!this.eventMonitoringActive) {
            console.log('[CipherPayService] Event monitoring not active');
            return;
        }

        console.log('[CipherPayService] Stopping event monitoring...');
        if (this.stopEventStream) {
            this.stopEventStream();
            this.stopEventStream = null;
        }
        this.eventMonitoringActive = false;
        console.log('[CipherPayService] Event monitoring stopped');
    }

    // Configuration Management
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        console.log('Configuration updated:', this.config);
    }

    // Cleanup
    async destroy() {
        // Stop event monitoring
        this.stopEventMonitoring();
        
        if (this.sdk) {
            try {
                // Note: SDK no longer has stopEventMonitoring or destroy methods
                // as event monitoring is now via server SSE
                this.sdk = null;
                this.isInitialized = false;
                console.log('CipherPay SDK destroyed successfully');
            } catch (error) {
                console.error('Failed to destroy SDK:', error);
            }
        }
    }
}

// Create a singleton instance
const cipherPayService = new CipherPayService();
export { CipherPayService };
export default cipherPayService; 