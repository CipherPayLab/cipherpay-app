import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { groth16ProofToHex, normalizeHex64, serializePublicSignals } from "../utils/proof.js";

const RELAYER_URL = process.env.RELAYER_URL || "http://localhost:3000";
const RELAYER_TOKEN = process.env.RELAYER_TOKEN || process.env.API_TOKEN || "";

export default async function (app: FastifyInstance) {
  app.post("/api/v1/submit/transfer", { preHandler: app.auth }, async (req, rep) => {
    const body = z
      .object({
        operation: z.string().optional(),
        tokenMint: z.string(),
        proof: z.any().optional(),
        publicSignals: z.array(z.string()).optional(),
        proofBytes: z.string().optional(),
        publicInputsBytes: z.string().optional(),
        out1Commitment: z.string().optional(),
        out2Commitment: z.string().optional(),
        nullifier: z.string().optional(),
        oldMerkleRoot: z.string().optional(),
        newMerkleRoot1: z.string().optional(),
        newMerkleRoot2: z.string().optional(),
        newNextLeafIndex: z.string().optional(),
        inAmount: z.number().or(z.string()).optional(),
        out1Amount: z.number().or(z.string()).optional(),
        out2Amount: z.number().or(z.string()).optional(),
      })
      .parse(req.body);

    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (RELAYER_TOKEN) {
        headers.authorization = `Bearer ${RELAYER_TOKEN}`;
      }

      const response = await fetch(`${RELAYER_URL}/api/v1/submit/transfer`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        return rep.status(response.status).send({
          ok: false,
          error: "RelayerError",
          message: text,
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
            where: { nullifier_hex: nullifierHex, kind: "note-transfer" },
            data: {
              proof_hex: proofHex,
              proof_public_signals: proofPublicSignals,
              verifier_key_id: env.verifierKeyId,
            },
          });
          if (updated.count > 0) {
            req.log.info(
              { nullifierHex, count: updated.count },
              "[transfer.submit] Persisted proof to messages"
            );
          } else {
            req.log.warn(
              { nullifierHex },
              "[transfer.submit] No messages row matched nullifier — proof not saved"
            );
          }
        } catch (err) {
          req.log.warn({ err, nullifierHex }, "[transfer.submit] Failed to persist proof");
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
