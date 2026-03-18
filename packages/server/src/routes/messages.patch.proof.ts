/**
 * PATCH /api/v1/messages/:contentHash/proof
 * Update a message with Groth16 proof (e.g. after on-chain submit, when proof is available)
 */
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";

export default async function (app: FastifyInstance) {
  app.patch(
    "/api/v1/messages/:contentHash/proof",
    { preHandler: app.auth },
    async (req, rep) => {
      // @ts-ignore
      const payload = req.user as { ownerKey: string };
      const ownerKey = payload.ownerKey;

      const params = z
        .object({
          contentHash: z.string().regex(/^(0x)?[0-9a-fA-F]+$/, "contentHash must be hex"),
        })
        .parse(req.params);

      const BodyZ = z.object({
        proofHex: z.string().regex(/^(0x)?[0-9a-fA-F]{1,512}$/, "proofHex: up to 512 hex chars"),
        proofPublicSignals: z.union([z.string(), z.array(z.string())]),
      });

      const body = BodyZ.parse(req.body);

      // DB stores content_hash with the 0x prefix — preserve it when querying
      const rawHash = params.contentHash.replace(/^0x/i, "");
      const contentHashWithPrefix = `0x${rawHash}`;
      const proofHex = body.proofHex.replace(/^0x/i, "");
      const proofPublicSignalsJson =
        typeof body.proofPublicSignals === "string"
          ? body.proofPublicSignals
          : JSON.stringify(body.proofPublicSignals);

      // Try both with and without 0x prefix to be safe
      const message = await prisma.messages.findFirst({
        where: {
          OR: [
            { content_hash: contentHashWithPrefix },
            { content_hash: rawHash },
          ],
          AND: [
            { OR: [{ recipient_key: ownerKey }, { sender_key: ownerKey }] },
          ],
        },
        select: { id: true, kind: true },
      });

      if (!message) {
        req.log.warn({ contentHashWithPrefix, ownerKey }, "[patch.proof] message not found");
        return rep.status(404).send({ error: "message_not_found" });
      }

      // Use circuit-specific verifier key based on message kind
      const verifierKeyId =
        message.kind === "note-withdraw" ? "groth16_withdraw_bn254_v1" :
        message.kind === "note-deposit"  ? "groth16_deposit_bn254_v1"  :
                                           "groth16_bn254_v1";

      await prisma.messages.update({
        where: { id: message.id },
        data: {
          proof_hex: proofHex,
          proof_public_signals: proofPublicSignalsJson,
          verifier_key_id: verifierKeyId,
        },
      });

      return rep.send({ ok: true });
    }
  );
}
