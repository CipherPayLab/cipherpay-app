import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { computeContentHash } from "../services/crypto.js";
import { KnownKindsZ } from "../validation/sdk.js";

/**
 * POST /api/v1/messages
 * Body:
 *  - recipientKey: 0x... (ownerCipherPayPubKey of recipient)
 *  - ciphertextB64: base64-encoded encrypted envelope (opaque to server)
 *  - kind: "note-transfer" | "note-deposit" | "note-message" | "note-withdraw"
 *  - senderKey?: 0x... (optional, sender's ownerCipherPayPubKey)
 *
 * Returns:
 *  - { id, contentHash }
 */
export default async function (app: FastifyInstance) {
  app.post("/api/v1/messages", { preHandler: app.auth }, async (req, rep) => {
    // @ts-ignore
    const payload = req.user as { ownerKey: string };
    const authenticatedOwnerKey = payload.ownerKey;

    const BodyZ = z.object({
      recipientKey: z.string().regex(/^0x[0-9a-fA-F]+$/, "recipientKey must be 0x-hex"),
      ciphertextB64: z.string().min(1, "ciphertextB64 required"),
      ciphertextAuditB64: z.string().optional(), // NEW: sender-encrypted audit receipt
      kind: KnownKindsZ.default("note-transfer"),
      senderKey: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
      nullifierHex: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(), // For withdraw messages
      amount: z.string().optional(), // Amount in lamports (as string to handle BigInt)
      proofHex: z.string().regex(/^(0x)?[0-9a-fA-F]{1,512}$/).optional(), // Groth16 proof (256 bytes = 512 hex chars)
      proofPublicSignals: z.union([z.string(), z.array(z.string())]).optional(), // JSON array of public signals
    });

    const body = BodyZ.parse(req.body);
    
    req.log.info({
      authenticatedOwnerKey,
      recipientKey: body.recipientKey,
      senderKey: body.senderKey,
      kind: body.kind,
    }, "[messages.post] Saving message");
    
    // For deposit notes, recipientKey should match authenticated user
    // Use authenticated user's ownerKey to ensure messages can be retrieved
    let finalRecipientKey = body.recipientKey;
    if (body.kind === "note-deposit") {
      if (body.recipientKey !== authenticatedOwnerKey) {
        req.log.warn({
          authenticatedOwnerKey,
          recipientKey: body.recipientKey,
        }, "[messages.post] Deposit note recipientKey doesn't match authenticated user, using authenticated ownerKey");
      }
      finalRecipientKey = authenticatedOwnerKey;
    }
    
    // Optional: Validate senderKey matches authenticated user (if provided)
    if (body.senderKey && body.senderKey !== authenticatedOwnerKey) {
      return rep.code(403).send({ error: "sender_key_mismatch" });
    }

    const ciphertext = Buffer.from(body.ciphertextB64, "base64");
    const ciphertextAudit = body.ciphertextAuditB64 
      ? Buffer.from(body.ciphertextAuditB64, "base64")
      : null;

    // Use cipherpay-sdk (via services/crypto) to compute deterministic content hash
    // Use finalRecipientKey for content hash to maintain consistency
    const h = await computeContentHash(finalRecipientKey as `0x${string}`, ciphertext);

    try {
      // Store amount as string (from BigInt) if provided
      const amountString = body.amount || null;
      
      // For deposits: nullifierHex contains the commitment (store in commitment_hex)
      // For transfers/withdraws: nullifierHex contains the actual nullifier
      const commitmentHex = body.kind === "note-deposit" ? (body.nullifierHex ?? null) : null;
      const nullifierHex = body.kind !== "note-deposit" ? (body.nullifierHex ?? null) : null;
      const proofPublicSignalsJson =
        body.proofPublicSignals != null
          ? typeof body.proofPublicSignals === "string"
            ? body.proofPublicSignals
            : JSON.stringify(body.proofPublicSignals)
          : null;
      const proofHex =
        body.proofHex != null ? body.proofHex.replace(/^0x/i, "") : null;

      const row = await prisma.messages.create({
        data: {
          recipient_key: finalRecipientKey,
          sender_key: body.senderKey ?? null,
          ciphertext,
          ciphertext_audit: ciphertextAudit,
          kind: body.kind,
          amount: amountString,
          content_hash: h,
          commitment_hex: commitmentHex,
          nullifier_hex: nullifierHex,
          proof_hex: proofHex,
          proof_public_signals: proofPublicSignalsJson,
          verifier_key_id: env.verifierKeyId,
        },
        select: { id: true },
      });

      // (Optional) publish SSE/Redis here if you wired it
      // Convert BigInt ID to string for JSON serialization
      return rep.send({ id: row.id.toString(), contentHash: h });
    } catch (e: any) {
      // Prisma unique constraint (content_hash) => duplicate message
      if (e.code === "P2002") return rep.code(409).send({ error: "duplicate_message" });
      throw e;
    }
  });
}
