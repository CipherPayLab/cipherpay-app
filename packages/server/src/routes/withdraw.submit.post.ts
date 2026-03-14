import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { groth16ProofToHex, normalizeHex64, serializePublicSignals } from "../utils/proof.js";

const RELAYER_URL = process.env.RELAYER_URL || "http://localhost:4000";
const RELAYER_TOKEN = process.env.RELAYER_TOKEN || process.env.API_TOKEN || "";

const BodySchema = z.object({
  operation: z.string().optional(),
  tokenMint: z.string(),
  proof: z.any(),
  publicSignals: z.array(z.string()),
  nullifier: z.string(),
  oldMerkleRoot: z.string(),
  recipientWalletPubKey: z.string(),
  amount: z.string(),
  tokenId: z.string(),
  recipientOwner_lo: z.string(),
  recipientOwner_hi: z.string(),
  recipientOwner: z.string(),
});

export default async function (app: FastifyInstance) {
  app.post("/api/v1/submit/withdraw", async (req, rep) => {
    const body = BodySchema.parse(req.body);

    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (RELAYER_TOKEN) headers.authorization = `Bearer ${RELAYER_TOKEN}`;

      const response = await fetch(`${RELAYER_URL}/api/v1/submit/withdraw`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        let message = text;
        try {
          const errJson = JSON.parse(text);
          message = errJson.message ?? errJson.error ?? text;
        } catch {
          /* text is not JSON (e.g. HTML), use friendly fallback */
          message = "The withdraw failed. Please try again.";
        }
        if (message.includes("<!") || message.includes("<html")) {
          message = "The withdraw failed. Please try again.";
        }
        return rep.status(response.status).send({
          ok: false,
          error: "RelayerError",
          message,
        });
      }

      const data = await response.json();

      // ---- Persist ZK proof to messages table ---------------------------------
      if (body.nullifier && body.proof && body.publicSignals?.length) {
        const nullifierHex = normalizeHex64(body.nullifier);
        try {
          const proofHex = groth16ProofToHex(body.proof as any);
          const proofPublicSignals = serializePublicSignals(body.publicSignals);
          const updated = await prisma.messages.updateMany({
            where: { nullifier_hex: nullifierHex, kind: "note-withdraw" },
            data: {
              proof_hex: proofHex,
              proof_public_signals: proofPublicSignals,
              verifier_key_id: env.verifierKeyId,
            },
          });
          if (updated.count > 0) {
            req.log.info(
              { nullifierHex, count: updated.count },
              "[withdraw.submit] Persisted proof to messages"
            );
          } else {
            req.log.warn(
              { nullifierHex },
              "[withdraw.submit] No messages row matched nullifier — proof not saved"
            );
          }
        } catch (err) {
          req.log.warn({ err, nullifierHex }, "[withdraw.submit] Failed to persist proof");
        }
      }

      return rep.send(data);
    } catch (error: any) {
      app.log.error(error);
      return rep.status(500).send({
        ok: false,
        error: "InternalError",
        message: error?.message || String(error),
      });
    }
  });
}

