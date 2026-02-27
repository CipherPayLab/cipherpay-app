// Account Overview Service
// Fetches messages from backend, decrypts them, and computes account overview

import { decryptFromSenderForMe, decryptAuditReceipt } from '../lib/e2ee';

// Same as authService: empty string = same-origin (dev Vite proxy or prod single domain)
const API_BASE_URL = (import.meta.env.VITE_SERVER_URL && String(import.meta.env.VITE_SERVER_URL).trim()) || import.meta.env.VITE_API_URL || '';

// Request deduplication: track in-flight requests
const inFlightRequests = new Map();

/**
 * Fetch messages for the authenticated user
 */
export async function fetchMessages(options = {}) {
  const {
    recipientKey = null,
    senderKey = null,
    unreadOnly = false,
    limit = 100,
    offset = 0,
  } = options;

  const token = localStorage.getItem('cipherpay_token');
  if (!token) {
    throw new Error('Not authenticated');
  }

  const params = new URLSearchParams();
  if (recipientKey) params.append('recipientKey', recipientKey);
  if (senderKey) params.append('senderKey', senderKey);
  if (unreadOnly) params.append('unreadOnly', 'true');
  params.append('limit', limit.toString());
  params.append('offset', offset.toString());

  const url = `${API_BASE_URL}/api/v1/messages?${params}`;
  
  // Check if request is already in flight
  if (inFlightRequests.has(url)) {
    return inFlightRequests.get(url);
  }

  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

  const requestPromise = (async () => {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch messages' }));
        const errorMessage = error.message || `HTTP ${response.status}`;
        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Request timed out after 30 seconds');
      }
      throw error;
    } finally {
      // Remove from in-flight requests
      inFlightRequests.delete(url);
    }
  })();

  // Store in-flight request
  inFlightRequests.set(url, requestPromise);

  return requestPromise;
}

/**
 * Decrypt messages and extract notes
 * @param {Array} messages - Array of message objects with ciphertext
 * @returns {Array} Array of decrypted notes
 */
export function decryptMessages(messages) {
  const notes = [];
  
  for (const msg of messages) {
    try {
      // Decrypt the ciphertext
      const decrypted = decryptFromSenderForMe(msg.ciphertext);
      
      if (decrypted && decrypted.note) {
        // Convert hex strings to BigInt if needed
        const note = {
          amount: typeof decrypted.note.amount === 'string' 
            ? BigInt(decrypted.note.amount.startsWith('0x') ? decrypted.note.amount : `0x${decrypted.note.amount}`)
            : BigInt(decrypted.note.amount),
          tokenId: typeof decrypted.note.tokenId === 'string'
            ? BigInt(decrypted.note.tokenId.startsWith('0x') ? decrypted.note.tokenId : `0x${decrypted.note.tokenId}`)
            : BigInt(decrypted.note.tokenId),
          ownerCipherPayPubKey: typeof decrypted.note.ownerCipherPayPubKey === 'string'
            ? BigInt(decrypted.note.ownerCipherPayPubKey.startsWith('0x') ? decrypted.note.ownerCipherPayPubKey : `0x${decrypted.note.ownerCipherPayPubKey}`)
            : BigInt(decrypted.note.ownerCipherPayPubKey),
          randomness: {
            r: typeof decrypted.note.randomness?.r === 'string'
              ? BigInt(decrypted.note.randomness.r.startsWith('0x') ? decrypted.note.randomness.r : `0x${decrypted.note.randomness.r}`)
              : BigInt(decrypted.note.randomness?.r || 0),
            s: decrypted.note.randomness?.s 
              ? (typeof decrypted.note.randomness.s === 'string'
                  ? BigInt(decrypted.note.randomness.s.startsWith('0x') ? decrypted.note.randomness.s : `0x${decrypted.note.randomness.s}`)
                  : BigInt(decrypted.note.randomness.s))
              : undefined,
          },
          memo: decrypted.note.memo,
        };
        notes.push(note);
      }
    } catch (error) {
      console.error(`[accountOverviewService] Failed to decrypt message ${msg.id}:`, error);
      console.error(`[accountOverviewService] Error stack:`, error.stack);
      // Continue with other messages
    }
  }
  
  return notes;
}

/**
 * Compute account overview from decrypted notes
 * @param {Array} notes - Array of decrypted notes
 * @param {boolean} checkOnChain - Whether to check on-chain for nullifiers not in DB
 * @returns {Promise<Object>} Account overview object
 */
export async function computeAccountOverview(notes, checkOnChain = false) {
  const token = localStorage.getItem('cipherpay_token');
  if (!token) {
    throw new Error('Not authenticated');
  }

  // Convert notes to the format expected by the API (BigInts as hex strings)
  const notesForAPI = notes.map(note => ({
    amount: `0x${note.amount.toString(16)}`,
    tokenId: `0x${note.tokenId.toString(16)}`,
    ownerCipherPayPubKey: `0x${note.ownerCipherPayPubKey.toString(16)}`,
    randomness: {
      r: `0x${note.randomness.r.toString(16)}`,
      s: note.randomness.s ? `0x${note.randomness.s.toString(16)}` : undefined,
    },
    memo: note.memo,
  }));

  const response = await fetch(`${API_BASE_URL}/api/v1/account/overview`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      notes: notesForAPI,
      checkOnChain,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to compute account overview' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  const result = await response.json();
  
  // Convert hex strings back to BigInts
  return {
    shieldedBalance: BigInt(result.shieldedBalance),
    spendableNotes: result.spendableNotes,
    totalNotes: result.totalNotes,
    notes: result.notes.map(n => ({
      note: {
        amount: BigInt(n.note.amount),
        tokenId: BigInt(n.note.tokenId),
        ownerCipherPayPubKey: BigInt(n.note.ownerCipherPayPubKey),
        randomness: {
          r: BigInt(n.note.randomness.r),
          s: n.note.randomness.s ? BigInt(n.note.randomness.s) : undefined,
        },
        memo: n.note.memo,
      },
      nullifierHex: n.nullifierHex,
      isSpent: n.isSpent,
      amount: BigInt(n.amount),
    })),
  };
}

/**
 * Fetch messages, decrypt them, and compute account overview
 * @param {Object} options - Options for fetching messages and computing overview
 * @returns {Promise<Object>} Account overview object
 */
export async function fetchAccountOverview(options = {}) {
  const { checkOnChain = false, ...messageOptions } = options;
  
  // Fetch messages
  const { messages, total } = await fetchMessages(messageOptions);
  
  // Decrypt messages to get notes
  const notes = decryptMessages(messages || []);
  
  // If no notes, return empty overview
  if (notes.length === 0) {
    return {
      shieldedBalance: 0n,
      spendableNotes: 0,
      totalNotes: 0,
      notes: [],
    };
  }
  
  // Compute account overview
  const overview = await computeAccountOverview(notes, checkOnChain);
  
  return overview;
}

/**
 * Compare ciphertext and ciphertext_audit for messages
 * Decrypts both fields and compares them, outputting tokenIds
 * @param {Object} options - Options for fetching messages
 * @returns {Promise<Array>} Array of comparison results
 */
export async function compareCiphertextAndAudit(options = {}) {
  const token = localStorage.getItem('cipherpay_token');
  if (!token) {
    throw new Error('Not authenticated');
  }

  // Extract ownerKey from JWT token
  let ownerKey = null;
  try {
    const tokenParts = token.split('.');
    if (tokenParts.length === 3) {
      const payload = JSON.parse(atob(tokenParts[1]));
      ownerKey = payload.ownerKey;
    }
  } catch (e) {
    console.warn('[compareCiphertextAndAudit] Could not extract ownerKey from token:', e);
  }

  // Fetch messages where user is recipient (default)
  const { messages: recipientMessages } = await fetchMessages(options);
  
  // Also fetch messages where user is sender (to get sent transfers with audit receipts)
  // Don't pass recipientKey to avoid filtering by recipient
  let senderMessages = [];
  if (ownerKey) {
    try {
      const { recipientKey, ...senderOptions } = options;
      const { messages: senderMsgs } = await fetchMessages({ ...senderOptions, senderKey: ownerKey });
      senderMessages = senderMsgs || [];
    } catch (e) {
      console.warn('[compareCiphertextAndAudit] Failed to fetch sender messages:', e);
    }
  }

  // Combine and deduplicate by message ID
  const allMessages = [...(recipientMessages || []), ...senderMessages];
  const messageMap = new Map();
  for (const msg of allMessages) {
    if (!messageMap.has(msg.id)) {
      messageMap.set(msg.id, msg);
    }
  }
  const messages = Array.from(messageMap.values());
  
  const comparisons = [];
  
  for (const msg of messages || []) {
    if (!msg.ciphertextAudit) {
      continue;
    }

    try {
      // Determine if user is sender or recipient
      const isSender = ownerKey && msg.senderKey && msg.senderKey.toLowerCase() === ownerKey.toLowerCase();
      
      // Decrypt ciphertext_audit (sender audit receipt) - only works if user is sender
      let decryptedAudit = null;
      let auditTokenId = null;
      
      if (isSender) {
        decryptedAudit = decryptAuditReceipt(msg.ciphertextAudit);
        auditTokenId = decryptedAudit?.tokenId;
      } else {
        continue;
      }
      
      if (!decryptedAudit) {
        continue;
      }
      
      // Extract audit tokenId
      let auditTokenIdStr = null;
      if (auditTokenId !== undefined && auditTokenId !== null) {
        if (typeof auditTokenId === 'string') {
          auditTokenIdStr = auditTokenId.startsWith('0x') ? auditTokenId : `0x${auditTokenId}`;
        } else if (typeof auditTokenId === 'bigint') {
          auditTokenIdStr = `0x${auditTokenId.toString(16)}`;
        } else {
          auditTokenIdStr = String(auditTokenId);
        }
      }
      
      // Format amount for display (convert from lamports to SOL)
      let amountFormatted = null;
      let amountSOL = null;
      if (decryptedAudit.amount) {
        try {
          const amountBigInt = typeof decryptedAudit.amount === 'string' 
            ? BigInt(decryptedAudit.amount.startsWith('0x') ? decryptedAudit.amount : `0x${decryptedAudit.amount}`)
            : BigInt(decryptedAudit.amount);
          amountSOL = Number(amountBigInt) / 1e9;
          amountFormatted = `${amountSOL} SOL`;
        } catch (e) {
          amountFormatted = decryptedAudit.amount;
        }
      }
      
      // Create formatted audit receipt for display
      const formattedAuditReceipt = {
        amount: amountFormatted || decryptedAudit.amount,
        amountRaw: decryptedAudit.amount,
        amountSOL: amountSOL,
        tokenId: auditTokenIdStr || decryptedAudit.tokenId,
        memo: decryptedAudit.memo,
        randomness: decryptedAudit.randomness,
        cipherPayPubKey: decryptedAudit.cipherPayPubKey,
        commitment: decryptedAudit.commitment,
      };
      
      const comparison = {
        messageId: msg.id,
        kind: msg.kind,
        senderKey: msg.senderKey,
        recipientKey: msg.recipientKey,
        createdAt: msg.createdAt,
        isSender,
        isRecipient,
        auditDecrypted: true,
        auditTokenId: auditTokenIdStr,
        auditFields: formattedAuditReceipt,
      };
      
      comparisons.push(comparison);
      
    } catch (error) {
      console.error(`[compareCiphertextAndAudit] Failed to compare message ${msg.id}:`, error);
      comparisons.push({
        messageId: msg.id,
        kind: msg.kind,
        error: error.message,
      });
    }
  }
  
  return comparisons;
}
