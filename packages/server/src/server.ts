import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rate from "@fastify/rate-limit";
import jwt from "./auth/jwt.js";
import { env } from "./config/env.js";
import { eventListener } from "./services/eventListener.js";

// Routes
import authChallenge from "./routes/auth.challenge.js";
import authVerify from "./routes/auth.verify.js";
import messagesPost from "./routes/messages.post.js";
import messagesPatchProof from "./routes/messages.patch.proof.js";
import messagesInbox from "./routes/messages.inbox.js";
import messagesAudit from "./routes/messages.audit.js";
import streamSse from "./routes/stream.sse.js";

// add imports
import usersMe from "./routes/users.get.me.js";
import usersLookup from "./routes/users.lookup.post.js";
import usersUsernameAvailable from "./routes/users.username.available.get.js";
import txList from "./routes/tx.get.list.js";
import txByCommitment from "./routes/tx.get.by-commitment.js";
import txByCommitmentDetail from "./routes/tx.get.by-commitment-detail.js";
import txByMerkleRoot from "./routes/tx.get.by-merkle-root.js";
import commitmentsPost from "./routes/commitments.post.js";
import merkleProofGet from "./routes/merkle-proof.get.js";
import merkleRootGet from "./routes/merkle.root.get.js";
import circuitsGet from "./routes/circuits.get.js";
import depositPrepare from "./routes/deposit.prepare.post.js";
import depositSubmit from "./routes/deposit.submit.post.js";
import transferPrepare from "./routes/transfer.prepare.post.js";
import transferSubmit from "./routes/transfer.submit.post.js";
import withdrawPrepare from "./routes/withdraw.prepare.post.js";
import withdrawSubmit from "./routes/withdraw.submit.post.js";
import nullifiersSync from "./routes/nullifiers.sync.post.js";
import accountOverview from "./routes/account.overview.post.js";
import messagesGet from "./routes/messages.get.js";
import relayerInfo from "./routes/relayer.info.get.js";
import usersNoteEncPubKey from "./routes/users.get.note-enc-pub-key.js";
import walletBalance from "./routes/wallet.balance.get.js";
import walletDelegateApproved from "./routes/wallet.delegate-approved.get.js";
import walletBlockhash from "./routes/wallet.blockhash.get.js";
import walletSubmitTransaction from "./routes/wallet.submit-transaction.post.js";

const app = Fastify({ 
  logger: true,
  // Configure connection handling to prevent connection leaks
  connectionTimeout: 60000, // 60 seconds - allow enough time for slow requests
  keepAliveTimeout: 30000,  // 30 seconds - shorter to free up connections faster
  maxRequestsPerSocket: 50, // Lower limit to cycle connections more frequently
  // Removed requestTimeout - let individual routes handle their own timeouts
  // requestTimeout was causing premature connection closures
});

await app.register(cors, { origin: env.corsOrigin, credentials: true });
await app.register(rate, { max: 100, timeWindow: "1 minute" });

app.get("/healthz", async () => ({ ok: true }));

// Define public relayer health endpoint directly (before JWT middleware)
// This route is public and does NOT require authentication
// Using a different path pattern to avoid conflicts
app.get("/relayer/health", async (req, rep) => {
  req.log.info("Relayer health check requested");
  try {
    const RELAYER_URL = process.env.RELAYER_URL || "http://localhost:4000";
    const RELAYER_TOKEN = process.env.RELAYER_TOKEN || process.env.API_TOKEN || "";
    
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (RELAYER_TOKEN) {
      headers.authorization = `Bearer ${RELAYER_TOKEN}`;
    }

    // Try /healthz first (public liveness check), fallback to /health if needed
    // Add timeout to prevent hanging (5 seconds)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    let healthEndpoint = "/healthz";
    let response;
    try {
      response = await fetch(`${RELAYER_URL}${healthEndpoint}`, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        throw new Error('Relayer health check timed out after 5 seconds');
      }
      throw fetchError;
    }
    
    // If healthz requires auth, try /health
    if (!response.ok && response.status === 401) {
      const controller2 = new AbortController();
      const timeoutId2 = setTimeout(() => controller2.abort(), 5000);
      try {
        healthEndpoint = "/health";
        response = await fetch(`${RELAYER_URL}${healthEndpoint}`, {
          method: "GET",
          headers,
          signal: controller2.signal,
        });
        clearTimeout(timeoutId2);
      } catch (fetchError: any) {
        clearTimeout(timeoutId2);
        if (fetchError.name === 'AbortError') {
          throw new Error('Relayer health check timed out after 5 seconds');
        }
        throw fetchError;
      }
    }

    // If still 401, relayer requires auth but we don't have token
    // Return a status indicating relayer is reachable but requires auth
    if (!response.ok && response.status === 401) {
      return rep.send({
        status: "degraded",
        message: "Relayer requires authentication. Health check unavailable without API token.",
      });
    }

    if (!response.ok) {
      const text = await response.text();
      return rep.status(response.status).send({
        status: "unhealthy",
        message: text || "Relayer health check failed",
      });
    }

    const data = await response.json();
    return rep.send(data);
  } catch (error: any) {
    req.log.error(error);
    return rep.status(503).send({
      status: "unreachable",
      message: error?.message || "Failed to connect to relayer",
    });
  }
});

await app.register(jwt);

await app.register(authChallenge);
await app.register(authVerify);
await app.register(messagesPost);
await app.register(messagesPatchProof);
await app.register(messagesInbox);
await app.register(messagesAudit);
await app.register(streamSse);

// register
await app.register(usersMe);
await app.register(usersLookup); // Public: lookup user by username
await app.register(usersUsernameAvailable); // Public: check username availability
await app.register(txList);
await app.register(txByCommitment);
await app.register(txByCommitmentDetail);
await app.register(txByMerkleRoot);
await app.register(commitmentsPost);
await app.register(merkleProofGet);
await app.register(merkleRootGet);
await app.register(circuitsGet);
await app.register(depositPrepare);
await app.register(depositSubmit);
await app.register(transferPrepare);
await app.register(transferSubmit);
await app.register(withdrawPrepare);
await app.register(withdrawSubmit);
await app.register(nullifiersSync);
await app.register(accountOverview);
await app.register(messagesGet);
await app.register(relayerInfo);
await app.register(usersNoteEncPubKey);
await app.register(walletBalance);
await app.register(walletDelegateApproved);
await app.register(walletBlockhash);
await app.register(walletSubmitTransaction);

// Graceful shutdown
process.on("SIGTERM", async () => {
  app.log.info("SIGTERM received, shutting down gracefully...");
  await eventListener.stop();
  await app.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  app.log.info("SIGINT received, shutting down gracefully...");
  await eventListener.stop();
  await app.close();
  process.exit(0);
});

// Listen first so the HTTP server is ready before the UI (or other clients) connect
await app.listen({ port: env.port, host: "0.0.0.0" });
app.log.info(`cipherpay-server listening on http://0.0.0.0:${env.port}`);

// Start on-chain event monitoring after server is listening
eventListener.start().catch((err) => {
  app.log.error({ err }, "Failed to start event listener");
});
