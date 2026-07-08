import { FastifyInstance } from "fastify";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

// Checks whether the relayer is already approved as an SPL-token delegate for the
// user's associated token account, entirely server-side. The browser cannot
// reliably hold a direct connection to the local validator in this environment —
// see wallet.balance.get.ts for the same reasoning.
const rpcUrl = process.env.SOLANA_RPC_URL || "http://localhost:8899";
const connection = new Connection(rpcUrl);

const RELAYER_URL = process.env.RELAYER_URL || "http://localhost:4000";
const RELAYER_TOKEN = process.env.RELAYER_TOKEN || process.env.API_TOKEN || "";
const DEFAULT_TOKEN_MINT = "So11111111111111111111111111111111111111112"; // wSOL

export default async function (app: FastifyInstance) {
  app.get("/api/wallet/delegate-approved", async (req, rep) => {
    const walletPubkeyParam = (req.query as any)?.wallet;
    const tokenMintParam = (req.query as any)?.tokenMint || DEFAULT_TOKEN_MINT;

    if (!walletPubkeyParam) {
      return rep.status(400).send({ ok: false, error: "missing wallet query param" });
    }

    try {
      // Get the relayer's own pubkey (same source as /api/relayer/info)
      const headers: Record<string, string> = {};
      if (RELAYER_TOKEN) headers.authorization = `Bearer ${RELAYER_TOKEN}`;
      const relayerInfoRes = await fetch(`${RELAYER_URL}/api/v1/relayer/info`, { headers });
      if (!relayerInfoRes.ok) {
        return rep.send({ ok: true, approved: false }); // Relayer unreachable — treat as not approved
      }
      const relayerInfo = await relayerInfoRes.json();
      const relayerPubkeyStr = relayerInfo?.relayerPubkey ?? relayerInfo?.relayerPubKey;
      if (!relayerPubkeyStr) {
        return rep.send({ ok: true, approved: false });
      }

      const walletPubkey = new PublicKey(walletPubkeyParam);
      const relayerPubkey = new PublicKey(relayerPubkeyStr);
      const userAta = getAssociatedTokenAddressSync(new PublicKey(tokenMintParam), walletPubkey);

      const accountInfo = await connection.getAccountInfo(userAta);
      if (!accountInfo || !accountInfo.data || accountInfo.data.length < 129) {
        return rep.send({ ok: true, approved: false });
      }

      const data = accountInfo.data;
      // SPL Token account layout: delegate COption at offset 72 (4-byte flag + 32-byte pubkey),
      // delegated_amount u64 at offset 121 (8 bytes).
      const delegateOption = data.readUInt32LE(72);
      if (delegateOption !== 1) {
        return rep.send({ ok: true, approved: false });
      }

      const delegateBytes = data.subarray(76, 108);
      const relayerBytes = relayerPubkey.toBytes();
      const delegateMatches = delegateBytes.length === relayerBytes.length &&
        delegateBytes.every((b, i) => b === relayerBytes[i]);
      if (!delegateMatches) {
        return rep.send({ ok: true, approved: false });
      }

      const delegatedAmount = data.readBigUInt64LE(121);
      return rep.send({ ok: true, approved: delegatedAmount > 0n });
    } catch (error: any) {
      req.log.error({ error: error?.message || String(error) }, "[wallet.delegate-approved] Check failed");
      return rep.send({ ok: true, approved: false });
    }
  });
}
