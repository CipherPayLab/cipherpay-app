// Nullifier tracking service
// Tracks which notes have been spent by querying on-chain NullifierRecord PDAs

import { Connection, PublicKey } from "@solana/web3.js";
import { prisma } from "../db/prisma.js";
import { normalizeNullifierHex } from "./nullifierUtils.js";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "http://localhost:8899";
const PROGRAM_ID = process.env.SOLANA_PROGRAM_ID || "WRy4hstBsD6hxb7CJN4R3fgLnafs621N7EjUhZ2afze";
const NULLIFIER_SEED = Buffer.from("nullifier");

/**
 * Derive nullifier PDA address from nullifier bytes
 */
export function deriveNullifierPda(nullifierBytes: Buffer | Uint8Array): PublicKey {
  const programId = new PublicKey(PROGRAM_ID);
  const [pda] = PublicKey.findProgramAddressSync(
    [NULLIFIER_SEED, Buffer.from(nullifierBytes)],
    programId
  );
  return pda;
}

/**
 * Check if a nullifier is used on-chain
 */
export async function checkNullifierOnChain(
  nullifierBytes: Buffer | Uint8Array,
  connection?: Connection
): Promise<{ used: boolean; txSignature?: string; spentAt?: Date } | null> {
  const conn = connection || new Connection(SOLANA_RPC_URL, "confirmed");
  const pda = deriveNullifierPda(nullifierBytes);

  try {
    const accountInfo = await conn.getAccountInfo(pda);
    
    if (!accountInfo) {
      // PDA doesn't exist = nullifier not used
      return { used: false };
    }

    // Decode NullifierRecord: used (bool) + bump (u8)
    // Layout: [discriminator (8 bytes)] + [used (1 byte)] + [bump (1 byte)]
    if (accountInfo.data.length < 10) {
      return null; // Invalid account data
    }

    const used = accountInfo.data[8] !== 0; // Skip 8-byte discriminator

    // Try to find the transaction that created this account
    let txSignature: string | undefined;
    let spentAt: Date | undefined;

    try {
      const signatures = await conn.getSignaturesForAddress(pda, { limit: 1 });
      if (signatures.length > 0) {
        txSignature = signatures[0].signature;
        spentAt = new Date(signatures[0].blockTime ? signatures[0].blockTime * 1000 : Date.now());
      }
    } catch (e) {
      // Ignore errors fetching transaction
    }

    return { used, txSignature, spentAt };
  } catch (error) {
    console.error(`Error checking nullifier on-chain:`, error);
    return null;
  }
}

/**
 * Store or update nullifier in database.
 * @param nullifierBytes - Raw nullifier bytes used for PDA derivation (must match on-chain seed).
 * @param onChainData - On-chain state data.
 * @param nullifierHexOverride - Optional hex string to use as the DB join key (nullifier_hex).
 *   Pass the big-endian hex when nullifierBytes are in little-endian (Anchor event) format so
 *   the JOIN with messages.nullifier_hex (which stores big-endian from snarkjs) works correctly.
 */
export async function upsertNullifier(
  nullifierBytes: Buffer | Uint8Array,
  onChainData: { used: boolean; txSignature?: string; spentAt?: Date; eventType?: string },
  nullifierHexOverride?: string
): Promise<void> {
  // Use the override hex (big-endian, matches messages.nullifier_hex) when provided,
  // otherwise fall back to the raw bytes hex (e.g. from syncNullifier where bytes are already BE).
  const nullifierHex = nullifierHexOverride ?? Buffer.from(nullifierBytes).toString("hex");
  const pda = deriveNullifierPda(nullifierBytes);
  const nullifierBuffer = Buffer.from(nullifierBytes);

  // Use Prisma's upsert if available, otherwise raw SQL
  try {
    await (prisma as any).nullifiers.upsert({
      where: { nullifier_hex: nullifierHex },
      update: {
        used: onChainData.used,
        tx_signature: onChainData.txSignature || undefined,
        spent_at: onChainData.spentAt || undefined,
        event_type: onChainData.eventType || undefined,
        synced_at: new Date(),
      },
      create: {
        nullifier: nullifierBuffer,
        nullifier_hex: nullifierHex,
        pda_address: pda.toBase58(),
        used: onChainData.used,
        tx_signature: onChainData.txSignature || null,
        spent_at: onChainData.spentAt || null,
        event_type: onChainData.eventType || null,
        synced_at: new Date(),
      },
    });
  } catch (error) {
    console.warn("[nullifiers] Prisma upsert failed, falling back to raw SQL:", error);
    // Fallback to raw SQL if Prisma model not available yet
    try {
      await prisma.$executeRaw`
        INSERT INTO nullifiers (
          nullifier,
          nullifier_hex,
          pda_address,
          used,
          tx_signature,
          event_type,
          spent_at,
          synced_at
        ) VALUES (
          ${nullifierBuffer},
          ${nullifierHex},
          ${pda.toBase58()},
          ${onChainData.used ? 1 : 0},
          ${onChainData.txSignature || null},
          ${onChainData.eventType || null},
          ${onChainData.spentAt || null},
          NOW()
        )
        ON DUPLICATE KEY UPDATE
          used = VALUES(used),
          tx_signature = COALESCE(VALUES(tx_signature), tx_signature),
          event_type = COALESCE(VALUES(event_type), event_type),
          spent_at = COALESCE(VALUES(spent_at), spent_at),
          synced_at = NOW(),
          updated_at = NOW()
      `;
    } catch (sqlError) {
      console.error("[nullifiers] Both Prisma and raw SQL failed:", sqlError);
      throw sqlError; // Re-throw to let caller handle
    }
  }
}

/**
 * Sync a single nullifier with on-chain state
 */
export async function syncNullifier(
  nullifierBytes: Buffer | Uint8Array,
  connection?: Connection
): Promise<boolean> {
  const onChainData = await checkNullifierOnChain(nullifierBytes, connection);
  
  if (!onChainData) {
    return false;
  }

  await upsertNullifier(nullifierBytes, onChainData);
  return true;
}

/**
 * Sync multiple nullifiers in batch
 */
export async function syncNullifiersBatch(
  nullifierBytesArray: (Buffer | Uint8Array)[],
  connection?: Connection
): Promise<{ synced: number; failed: number }> {
  const conn = connection || new Connection(SOLANA_RPC_URL, "confirmed");
  let synced = 0;
  let failed = 0;

  // Process in batches to avoid rate limits
  const BATCH_SIZE = 10;
  for (let i = 0; i < nullifierBytesArray.length; i += BATCH_SIZE) {
    const batch = nullifierBytesArray.slice(i, i + BATCH_SIZE);
    
    await Promise.all(
      batch.map(async (nullifierBytes) => {
        try {
          const success = await syncNullifier(nullifierBytes, conn);
          if (success) synced++;
          else failed++;
        } catch (error) {
          console.error(`Failed to sync nullifier:`, error);
          failed++;
        }
      })
    );

    // Small delay between batches
    if (i + BATCH_SIZE < nullifierBytesArray.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return { synced, failed };
}

/**
 * Get all nullifiers for a user (from their notes)
 * This would need to decrypt messages.ciphertext to extract nullifiers
 * For now, returns nullifiers from tx table where user is sender
 */
export async function getUserNullifiers(
  ownerCipherPayPubKey: string
): Promise<string[]> {
  // Get nullifiers from tx table where user is sender (they spent notes)
  try {
    const txs = await prisma.$queryRaw<Array<{ nullifier_hex: string | null }>>`
      SELECT DISTINCT nullifier_hex
      FROM tx
      WHERE sender_key = ${ownerCipherPayPubKey}
        AND nullifier_hex IS NOT NULL
    `;

    return txs.map((tx) => tx.nullifier_hex!).filter(Boolean);
  } catch (error) {
    // If nullifier_hex column doesn't exist yet, return empty array
    console.warn("nullifier_hex column may not exist in tx table yet:", error);
    return [];
  }
}

/**
 * Check if a nullifier is spent (database first, then on-chain if needed).
 * Uses normalized 64-char big-endian hex to match nullifiers.nullifier_hex.
 */
export async function isNullifierSpent(
  nullifierHex: string,
  checkOnChain: boolean = false
): Promise<boolean> {
  const normalizedHex = normalizeNullifierHex(nullifierHex);

  // Check database first using Prisma if available
  try {
    const nullifier = await (prisma as any).nullifiers.findUnique({
      where: { nullifier_hex: normalizedHex },
      select: { used: true },
    });

    if (nullifier) {
      return nullifier.used;
    }
  } catch (error) {
    // Fallback to raw SQL if Prisma model not available
    try {
      const nullifier = await prisma.$queryRaw<Array<{ used: number }>>`
        SELECT used
        FROM nullifiers
        WHERE nullifier_hex = ${normalizedHex}
        LIMIT 1
      `;

      if (nullifier.length > 0) {
        return nullifier[0].used !== 0;
      }
    } catch (e) {
      // Table may not exist yet
      console.warn("nullifiers table may not exist yet:", e);
    }
  }

  // Not in database, check on-chain if requested
  if (checkOnChain) {
    const nullifierBytes = Buffer.from(normalizedHex, "hex");
    const onChainData = await checkNullifierOnChain(nullifierBytes);
    
    if (onChainData) {
      await upsertNullifier(nullifierBytes, onChainData);
      return onChainData.used;
    }
  }

  // Default: assume not spent if not found
  return false;
}

/**
 * Sync all nullifiers for a user with on-chain state
 */
export async function syncUserNullifiers(
  ownerCipherPayPubKey: string,
  connection?: Connection
): Promise<{ synced: number; failed: number }> {
  const nullifierHexes = await getUserNullifiers(ownerCipherPayPubKey);
  const nullifierBytes = nullifierHexes.map((hex) => Buffer.from(hex, "hex"));
  
  return await syncNullifiersBatch(nullifierBytes, connection);
}

