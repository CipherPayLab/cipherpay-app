import { FastifyInstance } from "fastify";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, NATIVE_MINT } from "@solana/spl-token";

// Proxies wallet SOL + wSOL ATA balance lookups through the backend instead of
// having the browser talk to the Solana RPC endpoint directly. Browsers in this
// environment cannot reliably hold a direct connection to the local validator
// (requests stall indefinitely in Chrome's own socket pool), while the backend
// reaches it instantly — see packages/ui's Dashboard.jsx for the client side.
const rpcUrl = process.env.SOLANA_RPC_URL || "http://localhost:8899";
const connection = new Connection(rpcUrl);

export default async function (app: FastifyInstance) {
  app.get("/api/wallet/balance", async (req, rep) => {
    const pubkeyParam = (req.query as any)?.pubkey;
    if (!pubkeyParam) {
      return rep.status(400).send({ error: "missing pubkey query param" });
    }

    let publicKey: PublicKey;
    try {
      publicKey = new PublicKey(pubkeyParam);
    } catch {
      return rep.status(400).send({ error: "invalid pubkey" });
    }

    try {
      const walletBalance = await connection.getBalance(publicKey);

      let ataBalance = 0;
      let ataExists = false;
      try {
        const ata = getAssociatedTokenAddressSync(NATIVE_MINT, publicKey, false);
        const ataInfo = await connection.getAccountInfo(ata);
        if (ataInfo) {
          ataExists = true;
          const tokenAccount = await connection.getTokenAccountBalance(ata);
          ataBalance = Number(tokenAccount.value.amount);
        }
      } catch (ataError: any) {
        req.log.warn({ pubkey: pubkeyParam, error: ataError?.message }, "[wallet.balance] ATA lookup failed");
      }

      return rep.send({ ok: true, walletBalance, ataBalance, ataExists });
    } catch (error: any) {
      req.log.error({ pubkey: pubkeyParam, error: error?.message || String(error) }, "[wallet.balance] Failed to fetch balance");
      return rep.status(502).send({ ok: false, error: error?.message || "Failed to fetch balance" });
    }
  });
}
