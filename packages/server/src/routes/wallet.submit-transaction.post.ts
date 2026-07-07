import { FastifyInstance } from "fastify";
import { Connection } from "@solana/web3.js";

// Accepts an already wallet-signed transaction (base64-encoded raw bytes) from the
// browser and broadcasts + confirms it via the backend. The wallet must still sign
// client-side (only it holds the private key) — this endpoint only replaces the
// browser's own direct connection.sendRawTransaction()/confirmTransaction() calls,
// which cannot reliably reach the local validator in this environment.
const rpcUrl = process.env.SOLANA_RPC_URL || "http://localhost:8899";
const connection = new Connection(rpcUrl);

export default async function (app: FastifyInstance) {
  app.post("/api/wallet/submit-transaction", async (req, rep) => {
    const body = req.body as { signedTransaction?: string; commitment?: "processed" | "confirmed" | "finalized" };
    const signedTransaction = body?.signedTransaction;
    if (!signedTransaction) {
      return rep.status(400).send({ ok: false, error: "missing signedTransaction (base64)" });
    }

    try {
      const rawTx = Buffer.from(signedTransaction, "base64");
      const signature = await connection.sendRawTransaction(rawTx, { skipPreflight: false });

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        body?.commitment || "confirmed"
      );

      req.log.info({ signature }, "[wallet.submit-transaction] Transaction confirmed");
      return rep.send({ ok: true, signature });
    } catch (error: any) {
      req.log.error({ error: error?.message || String(error) }, "[wallet.submit-transaction] Failed to submit/confirm transaction");
      return rep.status(502).send({ ok: false, error: error?.message || "Failed to submit transaction" });
    }
  });
}
