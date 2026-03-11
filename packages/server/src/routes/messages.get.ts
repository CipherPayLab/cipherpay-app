// Messages endpoint
// Returns encrypted messages for the authenticated user so they can decrypt them client-side

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";

export default async function (app: FastifyInstance) {
  /**
   * GET /api/v1/messages
   * Returns all messages for the authenticated user
   * 
   * Query params:
   *   - recipientKey?: string  // Filter by recipient key (default: authenticated user's owner key)
   *   - senderKey?: string      // Filter by sender key
   *   - unreadOnly?: boolean    // Only return unread messages (default: false)
   *   - limit?: number          // Limit results (default: 100)
   *   - offset?: number         // Offset for pagination (default: 0)
   * 
   * Response: {
   *   messages: Array<{
   *     id: string,
   *     recipientKey: string,
   *     senderKey: string,
   *     ciphertext: string,  // Base64 encoded
   *     kind: string,
   *     contentHash: string,
   *     createdAt: string,
   *     readAt: string | null
   *   }>,
   *   total: number
   * }
   */
  app.get("/api/v1/messages", { preHandler: app.auth }, async (req, rep) => {
    // @ts-ignore
    const payload = req.user as { ownerKey: string };
    const ownerKey = payload.ownerKey;

    const query = z
      .object({
        recipientKey: z.string().optional(),
        senderKey: z.string().optional(),
        unreadOnly: z
          .union([z.string(), z.boolean()])
          .optional()
          .transform((val) => {
            if (typeof val === "string") return val === "true";
            return val ?? false;
          })
          .default(false),
        limit: z.coerce.number().int().positive().optional().default(100),
        offset: z.coerce.number().int().nonnegative().optional().default(0),
      })
      .parse(req.query);

    try {
      const where: any = {};
      
      // If senderKey is provided, we want to fetch messages where user is sender
      // Otherwise, default to authenticated user's messages as recipient
      if (query.senderKey) {
        where.sender_key = query.senderKey;
        // Only filter by recipientKey if explicitly provided
        if (query.recipientKey) {
          where.recipient_key = query.recipientKey;
          req.log.info({ recipientKey: query.recipientKey, senderKey: query.senderKey }, "[messages.get] Using both recipientKey and senderKey");
        } else {
          req.log.info({ senderKey: query.senderKey }, "[messages.get] Using senderKey only (user is sender)");
        }
      } else {
        // Default to authenticated user's messages as recipient
        if (query.recipientKey) {
          where.recipient_key = query.recipientKey;
          req.log.info({ recipientKey: query.recipientKey }, "[messages.get] Using query recipientKey");
        } else {
          where.recipient_key = ownerKey;
          req.log.info({ ownerKey, ownerKeyLength: ownerKey.length }, "[messages.get] Using authenticated ownerKey for filtering");
        }
      }

      if (query.unreadOnly) {
        where.read_at = null;
      }

      // Exclude failed note-deposits (tx_signature IS NULL) - these were never confirmed on-chain
      // and would cause "commitment not found" when trying to withdraw
      where.OR = [
        { kind: { not: "note-deposit" } },
        { tx_signature: { not: null } },
      ];

      const [messages, total] = await Promise.all([
        prisma.messages.findMany({
          where,
          orderBy: { created_at: "desc" },
          take: query.limit,
          skip: query.offset,
          select: {
            id: true,
            recipient_key: true,
            sender_key: true,
            ciphertext: true,
            ciphertext_audit: true,
            kind: true,
            content_hash: true,
            nullifier_hex: true,
            proof_hex: true,
            proof_public_signals: true,
            verifier_key_id: true,
            tx_signature: true,
            created_at: true,
            read_at: true,
          },
        }),
        prisma.messages.count({ where }),
      ]);

      // Convert ciphertext Buffer to base64
      // Handle empty messages array gracefully
      return rep.send({
        messages: (messages || []).map((msg) => ({
          id: msg.id.toString(),
          recipientKey: msg.recipient_key,
          senderKey: msg.sender_key,
          ciphertext: Buffer.from(msg.ciphertext).toString("base64"),
          ciphertextAudit: msg.ciphertext_audit ? Buffer.from(msg.ciphertext_audit).toString("base64") : null,
          kind: msg.kind,
          contentHash: msg.content_hash,
          nullifierHex: msg.nullifier_hex || null,
          proofHex: msg.proof_hex || null,
          proofPublicSignals: msg.proof_public_signals
            ? (() => {
                try {
                  return JSON.parse(msg.proof_public_signals as string);
                } catch {
                  return msg.proof_public_signals;
                }
              })()
            : null,
          verifierKeyId: msg.verifier_key_id,
          txSignature: msg.tx_signature || null,
          createdAt: msg.created_at.toISOString(),
          readAt: msg.read_at?.toISOString() || null,
        })),
        total: total || 0,
      });
    } catch (error: any) {
      app.log.error({ error }, "Failed to fetch messages");
      return rep.status(500).send({
        ok: false,
        error: "InternalError",
        message: error?.message || String(error),
      });
    }
  });
}

