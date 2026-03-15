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

      const contentHash = params.contentHash.replace(/^0x/i, "");
      const proofHex = body.proofHex.replace(/^0x/i, "");
      const proofPublicSignalsJson =
        typeof body.proofPublicSignals === "string"
          ? body.proofPublicSignals
          : JSON.stringify(body.proofPublicSignals);

      const message = await prisma.messages.findFirst({
        where: {
          content_hash: contentHash,
          OR: [{ recipient_key: ownerKey }, { sender_key: ownerKey }],
        },
        select: { id: true },
      });

      if (!message) {
        return rep.status(404).send({ error: "message_not_found" });
      }

      await prisma.messages.update({
        where: { id: message.id },
        data: {
          proof_hex: proofHex,
          proof_public_signals: proofPublicSignalsJson,
          verifier_key_id: env.verifierKeyId,
        },
      });

      return rep.send({ ok: true });
    }
  );
}
