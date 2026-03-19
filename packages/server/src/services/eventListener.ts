// src/services/eventListener.ts
// Monitors on-chain Anchor program events directly via Connection.onLogs

import { Connection, PublicKey } from "@solana/web3.js";
import { prisma } from "../db/prisma.js";
import { createClient, RedisClientType } from "redis";
import { upsertNullifier } from "./nullifiers.js";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "http://localhost:8899";
const PROGRAM_ID =
  process.env.SOLANA_PROGRAM_ID ||
  process.env.PROGRAM_ID ||
  "WRy4hstBsD6hxb7CJN4R3fgLnafs621N7EjUhZ2afze";
const REDIS_URL = process.env.REDIS_URL;

// Anchor IDL type definitions
interface DepositCompletedEvent {
  depositHash: number[];
  ownerCipherpayPubkey: number[];
  commitment: number[];
  oldMerkleRoot: number[];
  newMerkleRoot: number[];
  nextLeafIndex: number;
  mint: PublicKey;
}

interface TransferCompletedEvent {
  nullifier: number[];
  out1Commitment: number[];
  out2Commitment: number[];
  encNote1Hash: number[];
  encNote2Hash: number[];
  merkleRootBefore: number[];
  newMerkleRoot1: number[];
  newMerkleRoot2: number[];
  nextLeafIndex: number;
  mint: PublicKey;
}

interface WithdrawCompletedEvent {
  nullifier: number[];
  merkleRootUsed: number[];
  amount: bigint;
  mint: PublicKey;
  recipient: PublicKey;
}

// Helper: Convert byte array to hex string with 0x prefix (direct conversion, preserves byte order)
function toHex(bytes: number[] | Uint8Array): string {
  return "0x" + Buffer.from(bytes).toString("hex");
}

// Helper: Convert 32-byte little-endian buffer to bigint
function le32ToBigInt(buf: Buffer | Uint8Array | number[]): bigint {
  const b = Buffer.from(buf);
  let x = 0n;
  for (let i = b.length - 1; i >= 0; i--) {
    x = (x << 8n) | BigInt(b[i]);
  }
  return x;
}

// Helper: Convert bigint to 32-byte big-endian buffer
function bigIntToBe32(x0: bigint): Buffer {
  let x = x0;
  const out = Buffer.alloc(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

// Helper: Convert little-endian bytes (from Anchor event) to big-endian hex (for database storage)
// This matches how the relayer stores commitments in the merkle store
function le32ToBeHex(bytes: number[] | Uint8Array): string {
  const bigInt = le32ToBigInt(bytes);
  const beBytes = bigIntToBe32(bigInt);
  return "0x" + beBytes.toString("hex");
}

export class OnChainEventListener {
  private connection: Connection;
  private programId: PublicKey;
  private subscriptionId: number | null = null;
  private isRunning = false;
  private redis: RedisClientType | null = null;

  constructor() {
    this.connection = new Connection(SOLANA_RPC_URL, "confirmed");
    this.programId = new PublicKey(PROGRAM_ID);
  }

  async start() {
    if (this.isRunning) {
      console.log("[EventListener] Already running");
      return;
    }

    // Initialize Redis if configured
    if (REDIS_URL) {
      try {
        this.redis = createClient({ url: REDIS_URL });
        await this.redis.connect();
        console.log("[EventListener] Redis connected for event publishing");
      } catch (error) {
        console.warn("[EventListener] Redis connection failed, SSE won't work:", error);
      }
    }

    console.log(
      `[EventListener] Starting on-chain event monitoring for program: ${this.programId.toBase58()}`
    );
    console.log(`[EventListener] RPC URL: ${SOLANA_RPC_URL}`);

    try {
      const programAccount = await this.connection.getAccountInfo(this.programId);
      if (!programAccount) {
        console.warn(
          `[EventListener] Program account not found on this RPC. Check SOLANA_PROGRAM_ID/PROGRAM_ID and SOLANA_RPC_URL.`
        );
      }
    } catch (error) {
      console.warn("[EventListener] Failed to fetch program account info:", error);
    }

    this.subscriptionId = this.connection.onLogs(
      this.programId,
      async (logs, ctx) => {
        try {
          await this.handleLogs(logs, ctx);
        } catch (error) {
          console.error("[EventListener] Error handling logs:", error);
        }
      },
      "confirmed"
    );

    this.isRunning = true;
    console.log(`[EventListener] Subscribed to program logs (subscription ID: ${this.subscriptionId})`);
  }

  async stop() {
    if (!this.isRunning) return;

    if (this.subscriptionId !== null) {
      await this.connection.removeOnLogsListener(this.subscriptionId);
      console.log("[EventListener] Unsubscribed from program logs");
    }

    if (this.redis) {
      await this.redis.quit();
      console.log("[EventListener] Redis disconnected");
    }

    this.isRunning = false;
  }

  private async handleLogs(logs: any, ctx: any) {
    const { signature, err } = logs;

    console.log(`[EventListener] Received logs for tx: ${signature}, error: ${!!err}, log count: ${logs.logs?.length || 0}`);

    // Skip failed transactions
    if (err) {
      console.log(`[EventListener] Skipping failed tx: ${signature}`);
      return;
    }

    // Parse events from logs using Anchor's event parser
    // We need to extract events from the log lines
    const logMessages = logs.logs || [];
    
    for (const log of logMessages) {
      // Anchor events are emitted as base64-encoded data in logs
      // Format: "Program data: <base64>"
      if (log.startsWith("Program data: ")) {
        const base64Data = log.slice("Program data: ".length);
        try {
          const eventData = Buffer.from(base64Data, "base64");
          await this.parseAndStoreEvent(eventData, signature);
        } catch (error) {
          console.error("[EventListener] Error parsing event data:", error);
        }
      }
    }
  }

  private async parseAndStoreEvent(eventData: Buffer, txSignature: string) {
    // Anchor event format:
    // - 8 bytes: discriminator (first 8 bytes of sha256("event:<EventName>"))
    // - remaining: borsh-encoded event data

    const discriminator = eventData.slice(0, 8);
    const data = eventData.slice(8);

    // Event discriminators from IDL (first 8 bytes of sha256("event:<EventName>"))
    const DISCRIMINATORS = {
      depositCompleted: Buffer.from([87, 191, 139, 46, 172, 192, 191, 52]),
      transferCompleted: Buffer.from([208, 78, 51, 21, 201, 117, 155, 42]),
      withdrawCompleted: Buffer.from([180, 77, 152, 99, 248, 179, 163, 44]),
    };

    // Check discriminator first to determine event type
    if (discriminator.equals(DISCRIMINATORS.depositCompleted)) {
      try {
        await this.tryParseDepositCompleted(discriminator, data, txSignature);
        return;
      } catch (e) {
        console.error("[EventListener] Failed to parse DepositCompleted event:", e);
        return;
      }
    }

    if (discriminator.equals(DISCRIMINATORS.transferCompleted)) {
      try {
        await this.tryParseTransferCompleted(discriminator, data, txSignature);
        return;
      } catch (e) {
        console.error("[EventListener] Failed to parse TransferCompleted event:", e);
        return;
      }
    }

    if (discriminator.equals(DISCRIMINATORS.withdrawCompleted)) {
      try {
        await this.tryParseWithdrawCompleted(discriminator, data, txSignature);
        return;
      } catch (e) {
        console.error("[EventListener] Failed to parse WithdrawCompleted event:", e);
        return;
      }
    }

    // Unknown event discriminator
    console.log("[EventListener] Unknown event discriminator:", {
      discriminator: Array.from(discriminator),
      discriminatorHex: discriminator.toString("hex"),
      dataLength: data.length,
      expectedDiscriminators: {
        depositCompleted: Array.from(DISCRIMINATORS.depositCompleted),
        transferCompleted: Array.from(DISCRIMINATORS.transferCompleted),
        withdrawCompleted: Array.from(DISCRIMINATORS.withdrawCompleted),
      },
    });
  }

  private async tryParseDepositCompleted(
    discriminator: Buffer,
    data: Buffer,
    txSignature: string
  ) {
    // Manually decode the event (simpler approach without full IDL)
    // DepositCompleted layout:
    // - deposit_hash: [u8; 32]
    // - owner_cipherpay_pubkey: [u8; 32]
    // - commitment: [u8; 32]
    // - old_merkle_root: [u8; 32]
    // - new_merkle_root: [u8; 32]
    // - next_leaf_index: u32
    // - mint: Pubkey (32 bytes)

    if (data.length < 32 * 5 + 4 + 32) {
      throw new Error("Data too short for DepositCompleted");
    }

    let offset = 0;
    const depositHash = data.slice(offset, offset + 32);
    offset += 32;
    const ownerCipherpayPubkey = data.slice(offset, offset + 32);
    offset += 32;
    const commitment = data.slice(offset, offset + 32);
    offset += 32;
    const oldMerkleRoot = data.slice(offset, offset + 32);
    offset += 32;
    const newMerkleRoot = data.slice(offset, offset + 32);
    offset += 32;
    const nextLeafIndex = data.readUInt32LE(offset);
    offset += 4;
    const mint = new PublicKey(data.slice(offset, offset + 32));

    const event = {
      depositHash: Array.from(depositHash),
      ownerCipherpayPubkey: Array.from(ownerCipherpayPubkey),
      commitment: Array.from(commitment),
      oldMerkleRoot: Array.from(oldMerkleRoot),
      newMerkleRoot: Array.from(newMerkleRoot),
      nextLeafIndex,
      mint,
    };

    console.log("[EventListener] ✅ DepositCompleted event:", {
      commitment: toHex(event.commitment),
      index: event.nextLeafIndex,
      signature: txSignature,
    });

    // Store in database
    await this.storeDepositEvent(event, txSignature);

    // Publish to Redis for SSE
    await this.publishEvent("DepositCompleted", {
      commitment: toHex(event.commitment),
      ownerCipherpayPubkey: toHex(event.ownerCipherpayPubkey),
      merkleRoot: toHex(event.newMerkleRoot),
      index: event.nextLeafIndex,
      txSignature,
      mint: mint.toBase58(),
    });
  }

  private async tryParseTransferCompleted(
    discriminator: Buffer,
    data: Buffer,
    txSignature: string
  ) {
    // TransferCompleted layout:
    // - nullifier: [u8; 32]
    // - out1_commitment: [u8; 32]
    // - out2_commitment: [u8; 32]
    // - enc_note1_hash: [u8; 32]
    // - enc_note2_hash: [u8; 32]
    // - merkle_root_before: [u8; 32]
    // - new_merkle_root1: [u8; 32]
    // - new_merkle_root2: [u8; 32]
    // - next_leaf_index: u32
    // - mint: Pubkey (32 bytes)

    if (data.length < 32 * 8 + 4 + 32) {
      throw new Error("Data too short for TransferCompleted");
    }

    let offset = 0;
    const nullifier = data.slice(offset, offset + 32);
    offset += 32;
    const out1Commitment = data.slice(offset, offset + 32);
    offset += 32;
    const out2Commitment = data.slice(offset, offset + 32);
    offset += 32;
    const encNote1Hash = data.slice(offset, offset + 32);
    offset += 32;
    const encNote2Hash = data.slice(offset, offset + 32);
    offset += 32;
    const merkleRootBefore = data.slice(offset, offset + 32);
    offset += 32;
    const newMerkleRoot1 = data.slice(offset, offset + 32);
    offset += 32;
    const newMerkleRoot2 = data.slice(offset, offset + 32);
    offset += 32;
    const nextLeafIndex = data.readUInt32LE(offset);
    offset += 4;
    const mint = new PublicKey(data.slice(offset, offset + 32));

    console.log("[EventListener] ✅ TransferCompleted event:", {
      nullifier: toHex(nullifier),
      out1: toHex(out1Commitment),
      out2: toHex(out2Commitment),
      index: nextLeafIndex,
      signature: txSignature,
    });

    // Store both output commitments
    await this.storeTransferEvent(
      {
        nullifier: Array.from(nullifier),
        out1Commitment: Array.from(out1Commitment),
        out2Commitment: Array.from(out2Commitment),
        encNote1Hash: Array.from(encNote1Hash),
        encNote2Hash: Array.from(encNote2Hash),
        merkleRootBefore: Array.from(merkleRootBefore),
        newMerkleRoot1: Array.from(newMerkleRoot1),
        newMerkleRoot2: Array.from(newMerkleRoot2),
        nextLeafIndex,
        mint,
      },
      txSignature
    );

    // Publish to Redis
    await this.publishEvent("TransferCompleted", {
      out1Commitment: toHex(out1Commitment),
      out2Commitment: toHex(out2Commitment),
      merkleRoot: toHex(newMerkleRoot2), // Final root after both inserts
      index: nextLeafIndex,
      txSignature,
      mint: mint.toBase58(),
    });
  }

  private async tryParseWithdrawCompleted(
    discriminator: Buffer,
    data: Buffer,
    txSignature: string
  ) {
    // WithdrawCompleted layout:
    // - nullifier: [u8; 32]
    // - merkle_root_used: [u8; 32]
    // - amount: u64
    // - mint: Pubkey (32 bytes)
    // - recipient: Pubkey (32 bytes)

    if (data.length < 32 + 32 + 8 + 32 + 32) {
      throw new Error("Data too short for WithdrawCompleted");
    }

    let offset = 0;
    const nullifier = data.slice(offset, offset + 32);
    offset += 32;
    const merkleRootUsed = data.slice(offset, offset + 32);
    offset += 32;
    const amount = data.readBigUInt64LE(offset);
    offset += 8;
    const mint = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    const recipient = new PublicKey(data.slice(offset, offset + 32));

    console.log("[EventListener] ✅ WithdrawCompleted event:", {
      nullifier: toHex(nullifier),
      amount: amount.toString(),
      recipient: recipient.toBase58(),
      signature: txSignature,
    });

    // Store in database
    const ownerKey = await this.storeWithdrawEvent(
      {
        nullifier: Array.from(nullifier),
        merkleRootUsed: Array.from(merkleRootUsed),
        amount,
        mint,
        recipient,
      },
      txSignature
    );

    // Publish to Redis
    await this.publishEvent("WithdrawCompleted", {
      nullifier: toHex(nullifier),
      merkleRoot: toHex(merkleRootUsed),
      amount: amount.toString(),
      recipient: recipient.toBase58(),
      txSignature,
      mint: mint.toBase58(),
      ownerCipherpayPubkey: ownerKey ?? undefined,
    });
  }

  private async storeDepositEvent(event: any, txSignature: string) {
    try {
      // IMPORTANT: Anchor events provide commitments in little-endian format, but we store them
      // in big-endian format to match how the SDK computes commitments and how the relayer stores them.
      const commitmentHexBE = le32ToBeHex(event.commitment);
      const commitmentHex = commitmentHexBE.replace(/^0x/, '');
      
      await prisma.tx.upsert({
        where: { commitment: commitmentHexBE },
        update: {
          leaf_index: event.nextLeafIndex,
          merkle_root: le32ToBeHex(event.newMerkleRoot),
          signature: txSignature,
          event: "DepositCompleted",
        },
        create: {
          chain: "solana",
          commitment: commitmentHexBE,
          leaf_index: event.nextLeafIndex,
          merkle_root: le32ToBeHex(event.newMerkleRoot),
          signature: txSignature,
          event: "DepositCompleted",
        },
      });

      // Update the deposit message with the transaction signature
      // The message was created during prepare/deposit with commitment stored in commitment_hex field
      // IMPORTANT: Also verify recipient_key matches to prevent updating wrong user's messages
      try {
        const ownerKey = le32ToBeHex(event.ownerCipherpayPubkey);
        const updated = await prisma.messages.updateMany({
          where: {
            commitment_hex: commitmentHex, // Commitment stored in commitment_hex field
            kind: "note-deposit",
            recipient_key: ownerKey, // Verify recipient_key matches to prevent cross-user updates
          },
          data: {
            tx_signature: txSignature,
          },
        });
        if (updated.count > 0) {
          console.log(`[EventListener] Updated deposit message with tx signature: ${txSignature} for owner: ${ownerKey.slice(0, 20)}...`);
        } else {
          console.warn(`[EventListener] No deposit message found for commitment: ${commitmentHex} and owner: ${ownerKey.slice(0, 20)}...`);
        }
      } catch (msgError) {
        console.error("[EventListener] Failed to update deposit message:", msgError);
        // Don't fail the whole event processing if message update fails
      }

      console.log(`[EventListener] Stored DepositCompleted in database`);
    } catch (error) {
      console.error("[EventListener] Failed to store DepositCompleted:", error);
    }
  }

  private async storeTransferEvent(event: any, txSignature: string) {
    try {
      // Event nullifier comes as number[] (bytes from Anchor event)
      // Anchor events provide field elements as 32-byte arrays in little-endian format.
      // Keep raw LE bytes for PDA derivation (must match the on-chain seed).
      // Convert to big-endian hex for the DB join key so it matches messages.nullifier_hex
      // (which stores big-endian from snarkjs public signals).
      const nullifierBytes = Buffer.from(event.nullifier);
      const nullifierHex = le32ToBeHex(event.nullifier).replace(/^0x/i, "").toLowerCase();

      // Store nullifier in nullifiers table (pass big-endian hex override for the join key)
      try {
        await upsertNullifier(nullifierBytes, {
          used: true,
          txSignature,
          spentAt: new Date(),
          eventType: "transfer",
        }, nullifierHex);
      } catch (nullifierError) {
        console.error("[EventListener] Failed to save nullifier:", nullifierError);
        // Continue with storing commitments even if nullifier save fails
      }

      // Note: We don't populate recipient_key/sender_key for transfers in the tx table
      // because this information is already in the messages table and would be redundant.
      // The tx.get.list route already looks up these values from messages when needed.
      // IMPORTANT: Anchor events provide commitments in little-endian format, but we store them
      // in big-endian format to match how the SDK computes commitments and how the relayer stores them.
      const out1CommitmentHex = le32ToBeHex(event.out1Commitment);
      const out2CommitmentHex = le32ToBeHex(event.out2Commitment);

      // Store out1 (recipient's note)
      await prisma.tx.upsert({
        where: { commitment: out1CommitmentHex },
        update: {
          leaf_index: event.nextLeafIndex,
          merkle_root: le32ToBeHex(event.newMerkleRoot1),
          signature: txSignature,
          event: "TransferCompleted",
          nullifier_hex: nullifierHex,
        },
        create: {
          chain: "solana",
          commitment: out1CommitmentHex,
          leaf_index: event.nextLeafIndex,
          merkle_root: le32ToBeHex(event.newMerkleRoot1),
          signature: txSignature,
          event: "TransferCompleted",
          nullifier_hex: nullifierHex,
        },
      });

      // Store out2 (sender's change note)
      await prisma.tx.upsert({
        where: { commitment: out2CommitmentHex },
        update: {
          leaf_index: event.nextLeafIndex + 1,
          merkle_root: le32ToBeHex(event.newMerkleRoot2),
          signature: txSignature,
          event: "TransferCompleted",
          nullifier_hex: nullifierHex,
        },
        create: {
          chain: "solana",
          commitment: out2CommitmentHex,
          leaf_index: event.nextLeafIndex + 1,
          merkle_root: le32ToBeHex(event.newMerkleRoot2),
          signature: txSignature,
          event: "TransferCompleted",
          nullifier_hex: nullifierHex,
        },
      });

      // Update transfer messages with the transaction signature
      // Both out1 and out2 messages were created during prepare/transfer with nullifier_hex
      try {
        const updated = await prisma.messages.updateMany({
          where: {
            nullifier_hex: nullifierHex,
            kind: "note-transfer",
          },
          data: {
            tx_signature: txSignature,
          },
        });
        if (updated.count > 0) {
          console.log(`[EventListener] Updated ${updated.count} transfer message(s) with tx signature: ${txSignature}`);
        } else {
          console.warn(`[EventListener] No transfer messages found for nullifier: ${nullifierHex}`);
        }
      } catch (msgError) {
        console.error("[EventListener] Failed to update transfer messages:", msgError);
        // Don't fail the whole event processing if message update fails
      }

      console.log(`[EventListener] Stored TransferCompleted (2 commitments + nullifier) in database`);
    } catch (error) {
      console.error("[EventListener] Failed to store TransferCompleted:", error);
    }
  }

  private async storeWithdrawEvent(event: any, txSignature: string): Promise<string | null> {
    try {
      // Event nullifier comes as number[] (bytes from Anchor event)
      // Anchor events provide field elements as 32-byte arrays in little-endian format.
      // Keep raw LE bytes for PDA derivation (must match the on-chain seed).
      // Convert to big-endian hex for the DB join key so it matches messages.nullifier_hex
      // (which stores big-endian from snarkjs public signals).
      const nullifierBytes = Buffer.from(event.nullifier);
      const nullifierHex = le32ToBeHex(event.nullifier).replace(/^0x/i, "").toLowerCase();
      
      // Get owner key from the withdraw message (created during prepare phase)
      // The message's recipient_key is the owner's CipherPay pubkey
      let ownerKey: string | null = null;
      try {
        const message = await prisma.messages.findFirst({
          where: {
            nullifier_hex: nullifierHex,
            kind: "note-withdraw",
          },
          select: {
            recipient_key: true,
          },
        });
        ownerKey = message?.recipient_key ?? null;
      } catch (msgError) {
        console.error("[EventListener] Failed to find withdraw message for owner key:", msgError);
        // Continue without owner key - it's optional
      }

      // Store nullifier in nullifiers table (pass big-endian hex override for the join key)
      await upsertNullifier(nullifierBytes, {
        used: true,
        txSignature,
        spentAt: new Date(),
        eventType: "withdraw",
      }, nullifierHex);

      // For withdrawals, we don't have a commitment to store, but we can track the nullifier
      // We'll use a special format for the commitment field to track withdrawals
      const withdrawId = nullifierHex;
      
      await prisma.tx.upsert({
        where: { commitment: withdrawId },
        update: {
          leaf_index: 0, // No leaf index for withdrawals
          merkle_root: le32ToBeHex(event.merkleRootUsed),
          signature: txSignature,
          event: "WithdrawCompleted",
          nullifier_hex: nullifierHex,
        },
        create: {
          chain: "solana",
          commitment: withdrawId, // Use nullifier as ID
          leaf_index: 0,
          merkle_root: le32ToBeHex(event.merkleRootUsed),
          signature: txSignature,
          event: "WithdrawCompleted",
          nullifier_hex: nullifierHex,
        },
      });

      // Update the withdraw message with the transaction signature
      // The message was created during prepare/withdraw with nullifier_hex
      try {
        const updated = await prisma.messages.updateMany({
          where: {
            nullifier_hex: nullifierHex,
            kind: "note-withdraw",
          },
          data: {
            tx_signature: txSignature,
          },
        });
        if (updated.count > 0) {
          console.log(`[EventListener] Updated withdraw message with tx signature: ${txSignature}`);
        } else {
          console.warn(`[EventListener] No withdraw message found for nullifier: ${nullifierHex}`);
        }
      } catch (msgError) {
        console.error("[EventListener] Failed to update withdraw message:", msgError);
        // Don't fail the whole event processing if message update fails
      }

      console.log(`[EventListener] Stored WithdrawCompleted (nullifier) in database`);
      return ownerKey;
    } catch (error) {
      console.error("[EventListener] Failed to store WithdrawCompleted:", error);
      return null;
    }
  }

  private async publishEvent(eventType: string, data: any) {
    if (!this.redis) return;

    try {
      // Publish to recipient's channel if available
      if (data.ownerCipherpayPubkey) {
        const channel = `inbox:${data.ownerCipherpayPubkey}`;
        await this.redis.publish(
          channel,
          JSON.stringify({ type: eventType, ...data })
        );
        console.log(`[EventListener] Published ${eventType} to Redis channel: ${channel}`);
      }

      // Also publish to a general events channel
      await this.redis.publish(
        "events:all",
        JSON.stringify({ type: eventType, ...data })
      );
    } catch (error) {
      console.error("[EventListener] Failed to publish event to Redis:", error);
    }
  }
}

// Singleton instance
export const eventListener = new OnChainEventListener();

