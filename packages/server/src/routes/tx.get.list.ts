import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { normalizeOwnerCipherPayKey } from "../services/nullifierUtils.js";

export default async function (app: FastifyInstance) {
  app.get("/transactions", async (req, rep) => {
    const q = z
      .object({
        owner: z
          .string()
          .regex(/^0x[0-9a-fA-F]+$/)
          .optional(),
        kind: z.enum(["deposit", "transfer", "withdraw"]).optional(),
        limit: z.coerce.number().min(1).max(100).default(10),
        offset: z.coerce.number().int().nonnegative().optional().default(0),
        cursor: z.coerce.bigint().optional(),
        // Search parameters
        username: z.string().optional(), // Search by username (sender or recipient)
        dateFrom: z.string().optional(), // ISO date string
        dateTo: z.string().optional(), // ISO date string
        amountMin: z.coerce.number().optional(), // Minimum amount in SOL
        amountMax: z.coerce.number().optional(), // Maximum amount in SOL
        signature: z.string().optional(), // Transaction signature
      })
      .parse(req.query);

    // Look up owner key from username if provided
    let searchOwnerKey: string | null = null;
    if (q.username) {
      const normalizedUsername = q.username.replace(/^@/, '').toLowerCase();
      const user = await prisma.users.findUnique({
        where: { username: normalizedUsername },
        select: { owner_cipherpay_pub_key: true },
      });
      if (user) {
        searchOwnerKey = user.owner_cipherpay_pub_key;
      } else {
        // Username not found, return empty results
        return rep.send({
          activities: [],
          total: 0,
          limit: q.limit,
          offset: q.offset,
        });
      }
    }

    // Owner filter: use searchOwnerKey if username search, otherwise use q.owner
    // Normalize the owner key to ensure consistent matching (lowercase, 0x prefix)
    const ownerFilter = searchOwnerKey || q.owner;
    const normalizedOwnerFilter = ownerFilter ? normalizeOwnerCipherPayKey(ownerFilter) : null;

    // Build base where clause for tx table (no owner filtering - we'll filter via messages)
    const where: any = {};
    if (q.kind)
      where.event = q.kind[0].toUpperCase() + q.kind.slice(1) + "Completed";

    // Date range filter
    if (q.dateFrom || q.dateTo) {
      where.timestamp = {};
      if (q.dateFrom) {
        where.timestamp.gte = new Date(q.dateFrom);
      }
      if (q.dateTo) {
        // Add one day to include the entire end date
        const endDate = new Date(q.dateTo);
        endDate.setHours(23, 59, 59, 999);
        where.timestamp.lte = endDate;
      }
    }

    // Signature filter
    if (q.signature) {
      where.signature = q.signature;
    }

    // If owner filter is provided, we need to query messages first to get commitments/nullifiers
    // Then query tx table by those commitments/nullifiers
    let rows: any[] = [];
    if (normalizedOwnerFilter) {
      // Step 1: Query messages by owner to get commitments/nullifiers
      const messageWhere: any = {
        OR: [{ recipient_key: normalizedOwnerFilter }, { sender_key: normalizedOwnerFilter }],
        tx_signature: { not: null }, // Only processed messages
      };

      // Map message kinds to event types
      const kindToEvent: Record<string, string> = {
        'note-deposit': 'DepositCompleted',
        'note-transfer': 'TransferCompleted',
        'note-withdraw': 'WithdrawCompleted',
      };

      if (q.kind) {
        const eventType = q.kind[0].toUpperCase() + q.kind.slice(1) + "Completed";
        const matchingKinds = Object.entries(kindToEvent)
          .filter(([_, event]) => event === eventType)
          .map(([kind, _]) => kind);
        if (matchingKinds.length > 0) {
          messageWhere.kind = { in: matchingKinds };
        }
      }

      // Date range filter for messages
      if (q.dateFrom || q.dateTo) {
        messageWhere.created_at = {};
        if (q.dateFrom) {
          messageWhere.created_at.gte = new Date(q.dateFrom);
        }
        if (q.dateTo) {
          const endDate = new Date(q.dateTo);
          endDate.setHours(23, 59, 59, 999);
          messageWhere.created_at.lte = endDate;
        }
      }

      const ownerMessages = await prisma.messages.findMany({
        where: messageWhere,
        select: {
          nullifier_hex: true,
          commitment_hex: true,  // Added for deposit messages
          content_hash: true,
          kind: true,
          tx_signature: true,
        },
        take: q.limit * 2, // Get more to account for multiple messages per transaction
      });

      // Extract commitments/nullifiers from messages
      // For deposits: commitment is in commitment_hex
      // For transfers: nullifier_hex links to tx records
      // For withdrawals: nullifier_hex links to tx records
      const commitments = new Set<string>();
      const nullifiers = new Set<string>();

      ownerMessages.forEach(msg => {
        if (msg.kind === 'note-deposit' && msg.commitment_hex) {
          // For deposits, commitment is stored in commitment_hex
          const commitment = msg.commitment_hex.startsWith('0x') ? msg.commitment_hex : `0x${msg.commitment_hex}`;
          commitments.add(commitment);
        } else if (msg.nullifier_hex) {
          // For transfers/withdraws, use nullifier to find tx records
          nullifiers.add(msg.nullifier_hex);
        }
        // Also try content_hash as commitment
        if (msg.content_hash) {
          const commitment = msg.content_hash.startsWith('0x') ? msg.content_hash : `0x${msg.content_hash}`;
          commitments.add(commitment);
        }
      });

      // Step 2: Query tx table by commitments and nullifiers
      if (commitments.size > 0 || nullifiers.size > 0) {
        const txWhere: any = {
          ...where,
          OR: [
            ...(commitments.size > 0 ? [{ commitment: { in: Array.from(commitments) } }] : []),
            ...(nullifiers.size > 0 ? [{ nullifier_hex: { in: Array.from(nullifiers) } }] : []),
          ],
        };

        rows = await prisma.tx.findMany({
          where: txWhere,
          orderBy: { timestamp: "desc" },
          take: q.limit,
          ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        });
      }
    } else {
      // No owner filter - query tx table directly
      rows = await prisma.tx.findMany({
        where,
        orderBy: { timestamp: "desc" },
        take: q.limit,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      });
    }

    app.log.info({ 
      query: q, 
      searchOwnerKey, 
      normalizedOwnerFilter,
      rowsCount: rows.length,
      depositCount: rows.filter(r => r.event === 'DepositCompleted').length,
      transferCount: rows.filter(r => r.event === 'TransferCompleted').length,
      withdrawCount: rows.filter(r => r.event === 'WithdrawCompleted').length,
    }, "[/transactions] Query parameters and results");

    app.log.info({ 
      count: rows.length, 
      sample: rows[0],
      depositCount: rows.filter(r => r.event === 'DepositCompleted').length,
      transferCount: rows.filter(r => r.event === 'TransferCompleted').length,
      withdrawCount: rows.filter(r => r.event === 'WithdrawCompleted').length,
    }, "[/transactions] Found transactions");

    // Also get messages that have been processed on-chain (tx_signature IS NOT NULL)
    // This is especially important for deposits, which might not match in tx table due to key format issues
    // Only include if owner filter is provided
    let processedMessages: any[] = [];
    if (normalizedOwnerFilter) {
      const processedMessageWhere: any = {
        OR: [{ recipient_key: normalizedOwnerFilter }, { sender_key: normalizedOwnerFilter }],
        // Get messages that have been processed on-chain (have tx_signature)
        tx_signature: { not: null },
      };

      // Map message kinds to event types
      const kindToEvent: Record<string, string> = {
        'note-deposit': 'DepositCompleted',
        'note-transfer': 'TransferCompleted',
        'note-withdraw': 'WithdrawCompleted',
      };

      if (q.kind) {
        // Filter by message kind that matches the requested event type
        const eventType = q.kind[0].toUpperCase() + q.kind.slice(1) + "Completed";
        const matchingKinds = Object.entries(kindToEvent)
          .filter(([_, event]) => event === eventType)
          .map(([kind, _]) => kind);
        if (matchingKinds.length > 0) {
          processedMessageWhere.kind = { in: matchingKinds };
        }
      }

      // Date range filter for processed messages
      if (q.dateFrom || q.dateTo) {
        processedMessageWhere.created_at = {};
        if (q.dateFrom) {
          processedMessageWhere.created_at.gte = new Date(q.dateFrom);
        }
        if (q.dateTo) {
          const endDate = new Date(q.dateTo);
          endDate.setHours(23, 59, 59, 999);
          processedMessageWhere.created_at.lte = endDate;
        }
      }

      processedMessages = await prisma.messages.findMany({
        where: processedMessageWhere,
        orderBy: { created_at: "desc" },
        take: q.limit * 2,
      });

      app.log.info({ count: processedMessages.length, depositCount: processedMessages.filter(m => m.kind === 'note-deposit').length }, "[/transactions] Found processed messages (with tx_signature)");
    }

    // Also get messages that don't have corresponding tx records (pending activities)
    // Only include if owner filter is provided
    let pendingMessages: any[] = [];
    if (normalizedOwnerFilter) {
      const messageWhere: any = {
        OR: [{ recipient_key: normalizedOwnerFilter }, { sender_key: normalizedOwnerFilter }],
        // Only get messages without tx_signature (not yet processed on-chain)
        tx_signature: null,
      };

      // Map message kinds to event types
      // Note: We only query for note-transfer (not note-transfer-sent)
      // We'll determine sent vs change by comparing recipient_key to owner
      const kindToEvent: Record<string, string> = {
        'note-deposit': 'DepositCompleted',
        'note-transfer': 'TransferCompleted',
        'note-withdraw': 'WithdrawCompleted',
      };

      if (q.kind) {
        // Filter by message kind that matches the requested event type
        const eventType = q.kind[0].toUpperCase() + q.kind.slice(1) + "Completed";
        const matchingKinds = Object.entries(kindToEvent)
          .filter(([_, event]) => event === eventType)
          .map(([kind, _]) => kind);
        if (matchingKinds.length > 0) {
          messageWhere.kind = { in: matchingKinds };
        }
      }

      // Date range filter for messages
      if (q.dateFrom || q.dateTo) {
        messageWhere.created_at = {};
        if (q.dateFrom) {
          messageWhere.created_at.gte = new Date(q.dateFrom);
        }
        if (q.dateTo) {
          const endDate = new Date(q.dateTo);
          endDate.setHours(23, 59, 59, 999);
          messageWhere.created_at.lte = endDate;
        }
      }

      // Amount filter for messages (will be applied after fetching)
      // Note: Amount is stored as string in messages table

      pendingMessages = await prisma.messages.findMany({
        where: messageWhere,
        orderBy: { created_at: "desc" },
        take: q.limit * 2, // Get more messages to ensure we have both outputs for transfers
      });

      app.log.info({ count: pendingMessages.length }, "[/transactions] Found pending messages");

      // Filter pending messages by amount if specified
      if (q.amountMin !== undefined || q.amountMax !== undefined) {
        pendingMessages = pendingMessages.filter((msg: any) => {
          if (!msg.amount) return true; // Include messages without amount info
          
          const amountLamports = BigInt(msg.amount);
          const amountSOL = Number(amountLamports) / 1e9;
          
          if (q.amountMin !== undefined && amountSOL < q.amountMin) {
            return false;
          }
          
          if (q.amountMax !== undefined && amountSOL > q.amountMax) {
            return false;
          }
          
          return true;
        });
      }
    }

    // Convert processed messages (with tx_signature) to activity format
    // This is especially important for deposits which might not match in tx table due to key format issues
    const processedActivities = processedMessages.map((msg) => {
      const kindToEvent: Record<string, string> = {
        'note-deposit': 'DepositCompleted',
        'note-transfer': 'TransferCompleted',
        'note-withdraw': 'WithdrawCompleted',
      };

      const event = kindToEvent[msg.kind] || 'Unknown';
      
      // For deposits, commitment is stored in commitment_hex, not content_hash
      const commitment = msg.commitment_hex || msg.content_hash;
      
      // For transfers, use sender_key from message if available
      let finalSenderKey = msg.sender_key;
      if (!finalSenderKey && msg.kind === 'note-transfer' && ownerFilter) {
        finalSenderKey = ownerFilter;
      }
      
      return {
        id: `msg-processed-${msg.id}`, // Prefix to distinguish from tx records
        event,
        recipient_key: msg.recipient_key,
        sender_key: finalSenderKey,
        commitment: commitment ? (commitment.startsWith('0x') ? commitment : `0x${commitment}`) : msg.content_hash,
        nullifier_hex: msg.nullifier_hex,
        timestamp: msg.created_at,
        signature: msg.tx_signature,
        message: {
          id: String(msg.id),
          ciphertext: Buffer.from(msg.ciphertext).toString('base64'),
          kind: msg.kind,
          amount: msg.amount ? String(msg.amount) : null,
          content_hash: msg.content_hash,
          nullifier_hex: msg.nullifier_hex,
          proof_hex: msg.proof_hex ?? null,
          proof_public_signals: msg.proof_public_signals
            ? (() => {
                try {
                  return JSON.parse(msg.proof_public_signals);
                } catch {
                  return msg.proof_public_signals;
                }
              })()
            : null,
          verifier_key_id: msg.verifier_key_id ?? null,
        },
        _isFromMessages: true, // Flag to indicate this came from messages table
      };
    });

    // Convert pending messages to activity format
    // For transfers, determine sent vs change based on recipient_key comparison
    const pendingActivities = pendingMessages.map((msg) => {
      const kindToEvent: Record<string, string> = {
        'note-deposit': 'DepositCompleted',
        'note-transfer': 'TransferCompleted',
        'note-withdraw': 'WithdrawCompleted',
      };

      const event = kindToEvent[msg.kind] || 'Unknown';
      
      // For deposits, commitment is stored in commitment_hex, not content_hash
      // Use commitment_hex as commitment if it exists, otherwise use content_hash
      const commitment = msg.commitment_hex || msg.content_hash;
      
      // For transfers, use sender_key from message if available (populated by frontend)
      // Otherwise, fall back to comparing recipient_key to ownerFilter (for backward compatibility)
      let finalSenderKey = msg.sender_key;
      if (!finalSenderKey && msg.kind === 'note-transfer' && ownerFilter) {
        // Fallback: if sender_key not populated, assume ownerFilter is sender
        finalSenderKey = ownerFilter;
      }
      
      return {
        id: `msg-${msg.id}`, // Prefix to distinguish from tx records
        event,
        recipient_key: msg.recipient_key,
        sender_key: finalSenderKey,
        commitment: commitment ? (commitment.startsWith('0x') ? commitment : `0x${commitment}`) : msg.content_hash,
        nullifier_hex: msg.nullifier_hex,
        timestamp: msg.created_at,
        signature: msg.tx_signature,
        message: {
          id: String(msg.id),
          ciphertext: Buffer.from(msg.ciphertext).toString('base64'),
          kind: msg.kind,
          amount: msg.amount ? String(msg.amount) : null,
          content_hash: msg.content_hash,
          nullifier_hex: msg.nullifier_hex,
          proof_hex: msg.proof_hex ?? null,
          proof_public_signals: msg.proof_public_signals
            ? (() => {
                try {
                  return JSON.parse(msg.proof_public_signals);
                } catch {
                  return msg.proof_public_signals;
                }
              })()
            : null,
          verifier_key_id: msg.verifier_key_id ?? null,
        },
        _isPending: true, // Flag to indicate this is a pending activity
      };
    });

    // For transfers, we need special handling: find ALL messages for each transfer nullifier
    // and create activities for both outputs (recipient and sender/change)
    // First, collect all transfer tx records and their nullifiers
    const transferTxRecords = rows.filter(tx => tx.event === 'TransferCompleted');
    const transferNullifiers = new Set(
      transferTxRecords
        .map(tx => tx.nullifier_hex)
        .filter(Boolean) as string[]
    );

    // Batch query all transfer messages for these nullifiers
    // We only need note-transfer messages (not note-transfer-sent)
    // We'll determine "sent" vs "change" by comparing recipient_key to owner
    const allTransferMessages = transferNullifiers.size > 0
      ? await prisma.messages.findMany({
          where: {
            nullifier_hex: { in: Array.from(transferNullifiers) },
            kind: 'note-transfer', // Only get note-transfer messages
            ...(normalizedOwnerFilter ? {
              OR: [
                { recipient_key: normalizedOwnerFilter },
                { sender_key: normalizedOwnerFilter }
              ]
            } : {}),
          },
        })
      : [];

    // Create a map of nullifier -> messages
    const nullifierToMessages = new Map<string, any[]>();
    allTransferMessages.forEach(msg => {
      if (msg.nullifier_hex) {
        if (!nullifierToMessages.has(msg.nullifier_hex)) {
          nullifierToMessages.set(msg.nullifier_hex, []);
        }
        nullifierToMessages.get(msg.nullifier_hex)!.push(msg);
      }
    });

    // For each transaction, try to find the corresponding message
    // to include the encrypted note (which contains the amount)
    const enriched = await Promise.all(
      rows.map(async (tx) => {
        let message = null;
        
        app.log.debug({ 
          txId: tx.id, 
          event: tx.event, 
          commitment: tx.commitment?.slice(0, 20) + '...',
          nullifier_hex: tx.nullifier_hex?.slice(0, 20) + '...'
        }, "[/transactions] Attempting to match message for transaction");
        
        // Match transaction with message
        // For deposits: commitment is stored in commitment_hex field in messages table
        // For transfers/withdraws: use nullifier_hex to match
        if (tx.event === 'DepositCompleted') {
          // Try matching by commitment -> commitment_hex first (deposits store commitment in commitment_hex)
          if (tx.commitment) {
            // Remove 0x prefix if present for comparison
            const commitmentHex = tx.commitment.replace(/^0x/i, '');
            message = await prisma.messages.findFirst({
              where: {
                commitment_hex: commitmentHex,
                kind: 'note-deposit',
                tx_signature: tx.signature, // Match by signature to ensure correct message
              },
            });
          }
          // Fallback: try content_hash matching
          if (!message && tx.commitment) {
            message = await prisma.messages.findFirst({
              where: {
                content_hash: tx.commitment,
                kind: 'note-deposit',
                tx_signature: tx.signature,
              },
            });
          }
          // Final fallback: try by commitment only (if signature not available)
          if (!message && tx.commitment) {
            const commitmentHex = tx.commitment.replace(/^0x/i, '');
            message = await prisma.messages.findFirst({
              where: {
                nullifier_hex: commitmentHex,
                kind: 'note-deposit',
              },
              orderBy: { created_at: 'desc' },
            });
          }
        } else if (tx.event === 'TransferCompleted') {
          // For transfers, use the pre-fetched messages from the batch query
          // Match this tx record to the appropriate message
          if (tx.nullifier_hex && nullifierToMessages.has(tx.nullifier_hex)) {
            const messages = nullifierToMessages.get(tx.nullifier_hex)!;
            
            // If owner filter is provided, find the message where owner is the recipient
            // This ensures we match the correct message for this specific tx record
            if (normalizedOwnerFilter) {
              message = messages.find(msg => msg.recipient_key === normalizedOwnerFilter);
              // If not found, try to find any message (fallback)
              if (!message && messages.length > 0) {
                message = messages[0];
              }
            } else {
              // If no owner filter, just use the first message
              // (This is less accurate but works when no owner filter)
              message = messages[0];
            }
          }
          
        } else if (tx.event === 'WithdrawCompleted') {
          // Try matching by nullifier_hex first
          if (tx.nullifier_hex) {
            message = await prisma.messages.findFirst({
              where: {
                nullifier_hex: tx.nullifier_hex,
                kind: 'note-withdraw',
                tx_signature: tx.signature, // Match by signature to ensure correct message
              },
            });
          }
          // Fallback: try by commitment (content_hash)
          if (!message && tx.commitment) {
            message = await prisma.messages.findFirst({
              where: {
                content_hash: tx.commitment,
                kind: 'note-withdraw',
                tx_signature: tx.signature,
              },
            });
          }
          // Final fallback: try by nullifier only
          if (!message && tx.nullifier_hex) {
            message = await prisma.messages.findFirst({
              where: {
                nullifier_hex: tx.nullifier_hex,
                kind: 'note-withdraw',
              },
              orderBy: { created_at: 'desc' },
            });
          }
        }

        if (!message) {
          app.log.warn({ 
            txId: tx.id, 
            event: tx.event, 
            commitment: tx.commitment?.slice(0, 20) + '...',
            nullifier_hex: tx.nullifier_hex?.slice(0, 20) + '...'
          }, "[/transactions] No message found for transaction");
        } else {
          app.log.debug({ 
            txId: tx.id, 
            messageId: message.id,
            messageKind: message.kind
          }, "[/transactions] Successfully matched message for transaction");
        }

        // Get sender_key and recipient_key from message (not from tx table)
        // If no message found, we can't determine these keys
        let finalSenderKey = message?.sender_key ?? null;
        let finalRecipientKey = message?.recipient_key ?? null;
        
        if (tx.event === 'TransferCompleted' && message) {
          // For transfers, use sender_key from message if available (populated by frontend)
          // Otherwise, fall back to comparing recipient_key to owner
          if (!message.sender_key && normalizedOwnerFilter) {
            // Fallback: if sender_key not populated, assume normalizedOwnerFilter is sender
            finalSenderKey = normalizedOwnerFilter;
          }
        }

        return {
          ...tx,
          id: String(tx.id),
          sender_key: finalSenderKey,
          recipient_key: finalRecipientKey,
          message: message ? {
            id: String(message.id),
            ciphertext: Buffer.from(message.ciphertext).toString('base64'),
            kind: message.kind,
            amount: message.amount ? String(message.amount) : null,
            proof_hex: message.proof_hex ?? null,
            proof_public_signals: message.proof_public_signals
              ? (() => {
                  try {
                    return JSON.parse(message.proof_public_signals);
                  } catch {
                    return message.proof_public_signals;
                  }
                })()
              : null,
            verifier_key_id: message.verifier_key_id ?? null,
          } : null,
        };
      })
    );

    // For transfers, we need to ensure both outputs are shown
    // For each transfer nullifier, create activities for ALL messages
    // Determine "sent" vs "change" based on recipient_key comparison with owner
    const transferActivities: any[] = [];
    
    // Group enriched activities by nullifier to track which messages are already represented
    const enrichedByNullifier = new Map<string, any[]>();
    enriched.forEach((activity: any) => {
      if (activity.event === 'TransferCompleted' && activity.nullifier_hex) {
        if (!enrichedByNullifier.has(activity.nullifier_hex)) {
          enrichedByNullifier.set(activity.nullifier_hex, []);
        }
        enrichedByNullifier.get(activity.nullifier_hex)!.push(activity);
      }
    });
    
    // For each transfer nullifier, create activities for all messages
    // Simple logic: if recipient_key === owner, it's change; otherwise it's sent
    nullifierToMessages.forEach((messages, nullifier) => {
      const existingActivities = enrichedByNullifier.get(nullifier) || [];
      const existingMessageIds = new Set(
        existingActivities
          .map((a: any) => a.message?.id)
          .filter(Boolean)
      );
      
      // Find messages that don't have a corresponding activity yet
      const missingMessages = messages.filter(msg => !existingMessageIds.has(String(msg.id)));
      
      // Get a template tx record for this nullifier (for timestamp, signature, etc.)
      const templateTx = transferTxRecords.find(tx => tx.nullifier_hex === nullifier);
      
      if (templateTx && missingMessages.length > 0 && ownerFilter) {
        missingMessages.forEach(msg => {
          // Use sender_key from message if available (populated by frontend)
          // Otherwise, fall back to ownerFilter (for backward compatibility)
          const finalSenderKey = msg.sender_key || ownerFilter;
          const finalRecipientKey = msg.recipient_key;
          
          // Determine if this is "sent" or "change" based on recipient_key vs sender_key
          // If recipient_key === sender_key, it's change; otherwise it's sent
          const isChange = finalRecipientKey === finalSenderKey;
          const isSent = !isChange;
          
          transferActivities.push({
            ...templateTx,
            id: `tx-${templateTx.id}-msg-${msg.id}`, // Unique ID combining tx and message
            sender_key: finalSenderKey,
            recipient_key: finalRecipientKey,
            message: {
              id: String(msg.id),
              ciphertext: Buffer.from(msg.ciphertext).toString('base64'),
              kind: msg.kind,
              amount: msg.amount ? String(msg.amount) : null,
              content_hash: msg.content_hash,
              nullifier_hex: msg.nullifier_hex,
              proof_hex: msg.proof_hex ?? null,
              proof_public_signals: msg.proof_public_signals
                ? (() => {
                    try {
                      return JSON.parse(msg.proof_public_signals);
                    } catch {
                      return msg.proof_public_signals;
                    }
                  })()
                : null,
              verifier_key_id: msg.verifier_key_id ?? null,
            },
          });
        });
      }
    });

    // Combine tx-based activities, additional transfer activities, and confirmed message activities.
    // Pending activities (no tx_signature) are excluded — they represent unconfirmed ZK proof
    // generation attempts and should not appear as completed transactions.
    // Priority: enriched (tx-table) > transferActivities > processedActivities
    const allActivities = [...enriched, ...transferActivities, ...processedActivities];
    
    // Deduplicate: first occurrence always wins (priority order above is intentional).
    // Use message ID as primary key when available; fall back to commitment/nullifier/content_hash.
    const seen = new Set<string>();
    const deduplicated = allActivities
      .filter((activity: any) => {
        const messageIdKey = activity.message?.id ? `msg-${activity.message.id}` : null;
        const commitmentKey = activity.commitment ? activity.commitment.replace(/^0x/i, '') : null;
        const nullifierKey = activity.message?.nullifier_hex || activity.nullifier_hex;
        const contentHashKey = activity.message?.content_hash || activity.content_hash;
        
        const primaryKey = messageIdKey || commitmentKey || nullifierKey || contentHashKey;
        
        if (!primaryKey) return false;
        
        // First occurrence always wins — skip all subsequent duplicates regardless of source
        if (seen.has(primaryKey)) return false;
        
        seen.add(primaryKey);
        // Cross-register secondary keys so different paths to the same activity are caught
        if (messageIdKey && commitmentKey) seen.add(commitmentKey);
        if (messageIdKey && nullifierKey) seen.add(nullifierKey);
        if (messageIdKey && contentHashKey) seen.add(contentHashKey);
        
        return true;
      })
      .map((activity: any) => {
        // Remove internal flags before sending
        const { _isPending, _isFromMessages, ...cleanActivity } = activity;
        return cleanActivity;
      })
      .sort((a, b) => {
        // Sort by timestamp descending (most recent first)
        const timeA = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
        const timeB = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
        return timeB - timeA;
      });

    // Apply amount filtering if specified
    // Amount is stored in messages as string (in lamports), convert to SOL for comparison
    let filteredByAmount = deduplicated;
    if (q.amountMin !== undefined || q.amountMax !== undefined) {
      filteredByAmount = deduplicated.filter((activity: any) => {
        // Get amount from message if available
        const amountStr = activity.message?.amount;
        if (!amountStr) return true; // Include activities without amount info
        
        // Convert amount from string to number (in lamports)
        const amountLamports = BigInt(amountStr);
        const amountSOL = Number(amountLamports) / 1e9;
        
        // Check min amount
        if (q.amountMin !== undefined && amountSOL < q.amountMin) {
          return false;
        }
        
        // Check max amount
        if (q.amountMax !== undefined && amountSOL > q.amountMax) {
          return false;
        }
        
        return true;
      });
    }

    // Get total count before applying pagination
    const totalCount = filteredByAmount.length;

    // Apply pagination (offset and limit)
    const paginated = filteredByAmount.slice(q.offset, q.offset + q.limit);

    // Collect all unique owner keys (sender_key and recipient_key) to look up usernames
    // Normalize keys to ensure consistent matching (lowercase, with 0x prefix)
    const ownerKeys = new Set<string>();
    const keyMapping = new Map<string, string>(); // Maps original key -> normalized key
    
    paginated.forEach((activity: any) => {
      if (activity.sender_key) {
        const normalized = normalizeOwnerCipherPayKey(activity.sender_key);
        ownerKeys.add(normalized);
        keyMapping.set(activity.sender_key, normalized);
      }
      if (activity.recipient_key) {
        const normalized = normalizeOwnerCipherPayKey(activity.recipient_key);
        ownerKeys.add(normalized);
        keyMapping.set(activity.recipient_key, normalized);
      }
    });

    // Batch query usernames for all owner keys (using normalized keys)
    const usernameMap = new Map<string, string>();
    if (ownerKeys.size > 0) {
      const users = await prisma.users.findMany({
        where: {
          owner_cipherpay_pub_key: { in: Array.from(ownerKeys) },
        },
        select: {
          owner_cipherpay_pub_key: true,
          username: true,
        },
      });
      users.forEach((user) => {
        // Store username mapped to normalized key
        const normalizedKey = normalizeOwnerCipherPayKey(user.owner_cipherpay_pub_key);
        usernameMap.set(normalizedKey, user.username);
      });
    }

    // Add usernames to activities
    // Look up using normalized keys, but match against original keys in activities
    const activitiesWithUsernames = paginated.map((activity: any) => {
      const normalizedSenderKey = activity.sender_key ? keyMapping.get(activity.sender_key) || normalizeOwnerCipherPayKey(activity.sender_key) : null;
      const normalizedRecipientKey = activity.recipient_key ? keyMapping.get(activity.recipient_key) || normalizeOwnerCipherPayKey(activity.recipient_key) : null;
      
      return {
        ...activity,
        sender_username: normalizedSenderKey ? usernameMap.get(normalizedSenderKey) || null : null,
        recipient_username: normalizedRecipientKey ? usernameMap.get(normalizedRecipientKey) || null : null,
      };
    });

    app.log.info({ 
      txCount: enriched.length, 
      transferActivitiesCount: transferActivities.length,
      pendingCount: pendingActivities.length, 
      totalCount,
      offset: q.offset,
      limit: q.limit,
      returnedCount: paginated.length,
      usernameLookups: ownerKeys.size,
      usernamesFound: usernameMap.size,
    }, "[/transactions] Combined activities");

    return rep.send({
      activities: activitiesWithUsernames,
      total: totalCount,
      limit: q.limit,
      offset: q.offset,
    });
  });
}
