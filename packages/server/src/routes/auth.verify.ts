// src/routes/auth.verify.ts
import { FastifyInstance } from "fastify";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { poseidonLoginMsg, verifyBabyJubSig } from "../services/crypto.js";

const SESSION_COOKIE_NAME =
  process.env.CIPHERPAY_SESSION_COOKIE_NAME ?? "cipherpay_session_nonce";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24; // 24 hours

/**
 * POST /auth/verify
 * Body:
 *  - ownerKey: 0x... (ownerCipherPayPubKey)
 *  - nonce: hex (from /auth/challenge, NO 0x prefix)
 *  - signature: { R8x, R8y, S } (BabyJub EdDSA over Poseidon(nonce || ownerKey))
 *  - authPubKey?: { x, y } (optional: if first-time binding)
 *
 * Important: Never send raw BigInt in JSON responses — convert to strings first.
 */
export default async function (app: FastifyInstance) {
  app.post("/auth/verify", async (req, rep) => {
    try {
      // ---- Validation -------------------------------------------------------
      const hex0x = /^0x[0-9a-fA-F]+$/;
      const hexNo0x = /^[0-9a-fA-F]+$/;

      const BodyZ = z.object({
        ownerKey: z.string().regex(hex0x, "ownerKey must be 0x-hex"),
        nonce: z.string().regex(hexNo0x, "nonce must be hex string (no 0x)"),
        signature: z.object({
          R8x: z.string().regex(hex0x, "R8x must be 0x-hex"),
          R8y: z.string().regex(hex0x, "R8y must be 0x-hex"),
          S: z.string().regex(hex0x, "S must be 0x-hex"),
        }),
        authPubKey: z
          .object({
            x: z.string().regex(hex0x, "authPubKey.x must be 0x-hex"),
            y: z.string().regex(hex0x, "authPubKey.y must be 0x-hex"),
          })
          .optional(),
      });

      const body = BodyZ.parse(req.body);

      // ---- User & session lookup -------------------------------------------
      const user = await prisma.users.findUnique({
        where: { owner_cipherpay_pub_key: body.ownerKey },
      });
      if (!user) {
        return rep.code(400).send({ ok: false, error: "unknown_user" });
      }

      const session = await prisma.sessions.findFirst({
        where: { user_id: user.id, nonce: body.nonce },
        orderBy: { created_at: "desc" },
      });
      if (!session || session.expires_at < new Date()) {
        return rep
          .code(400)
          .send({ ok: false, error: "nonce_expired_or_invalid" });
      }

      // ---- Compute Poseidon(nonce || ownerKey) ------------------------------
      const nonceHex = ("0x" + body.nonce) as `0x${string}`;
      const msgField = await poseidonLoginMsg(
        nonceHex,
        body.ownerKey as `0x${string}`
      );

      // Log safely (no BigInt in JSON logs)
      req.log.info(
        {
          nonce: body.nonce,
          ownerKey: body.ownerKey,
          msgFieldHex: "0x" + msgField.toString(16),
        },
        "[auth.verify] Computed message field"
      );

      // ---- Determine public key for verification ---------------------------
      if (!user.auth_pub_x || !user.auth_pub_y) {
        return rep
          .code(400)
          .send({ ok: false, error: "user_missing_auth_pub_key" });
      }
      const pub = body.authPubKey ?? {
        x: user.auth_pub_x,
        y: user.auth_pub_y,
      };
      if (!pub.x || !pub.y) {
        return rep.code(400).send({ ok: false, error: "missing_auth_pub_key" });
      }

      req.log.info(
        {
          pub,
          sig: body.signature,
          msgFieldHex: "0x" + msgField.toString(16),
        },
        "[auth.verify] Verifying signature"
      );

      // ---- Verify signature -------------------------------------------------
      const ok = await verifyBabyJubSig({
        msgField,
        sig: body.signature as { R8x: string; R8y: string; S: string },
        pub: { x: pub.x!, y: pub.y! },
      });

      if (!ok) {
        return rep.code(401).send({ ok: false, error: "bad_signature" });
      }

      // ---- Issue JWT & JSON-safe response ----------------------------------
      const token = app.jwt.sign(
        { sub: String(user.id), ownerKey: user.owner_cipherpay_pub_key },
        { expiresIn: "1h" }
      );

      // ---- Set a long-lived session cookie for zkaudit cross-app auth ------
      // Cookies are domain-scoped (not port-scoped), so a cookie set by
      // localhost:8788 is automatically sent by the browser to localhost:3100.
      const sessionNonce = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
      try {
        await prisma.sessions.create({
          data: {
            user_id: user.id,
            nonce: sessionNonce,
            expires_at: expiresAt,
          },
        });
        const cookieValue = [
          `${SESSION_COOKIE_NAME}=${sessionNonce}`,
          "HttpOnly",
          "Path=/",
          "SameSite=Lax",
          `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
        ].join("; ");
        rep.header("Set-Cookie", cookieValue);
        req.log.info({ userId: String(user.id) }, "[auth.verify] Session cookie set");
      } catch (cookieErr) {
        req.log.warn({ err: cookieErr }, "[auth.verify] Failed to create session cookie; continuing");
      }

      // NOTE: user.id may be a BigInt depending on Prisma schema -> stringify it.
      return rep.code(200).send({
        ok: true,
        verified: true,
        token,
        user: {
          id: String(user.id),
          ownerKey: user.owner_cipherpay_pub_key,
          username: user.username,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "unknown");
      req.log.error({ err: message }, "[auth.verify] ERROR during verification");

      return rep
        .code(500)
        .send({ ok: false, error: "verification_failed", details: message });
    }
  });
}
