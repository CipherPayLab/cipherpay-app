import { FastifyInstance } from "fastify";
import { Connection } from "@solana/web3.js";

// Proxies getLatestBlockhash through the backend — see wallet.balance.get.ts for why
// the browser cannot reliably talk to the validator directly in this environment.
const rpcUrl = process.env.SOLANA_RPC_URL || "http://localhost:8899";
const connection = new Connection(rpcUrl);

export default async function (app: FastifyInstance) {
  app.get("/api/wallet/latest-blockhash", async (req, rep) => {
    try {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      return rep.send({ ok: true, blockhash, lastValidBlockHeight });
    } catch (error: any) {
      req.log.error({ error: error?.message || String(error) }, "[wallet.blockhash] Failed to fetch latest blockhash");
      return rep.status(502).send({ ok: false, error: error?.message || "Failed to fetch latest blockhash" });
    }
  });
}
