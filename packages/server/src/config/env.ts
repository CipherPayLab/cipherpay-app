export const env = {
  port: Number(process.env.PORT ?? 8788),
  jwtSecret: process.env.JWT_SECRET ?? "dev-insecure-change-me",
  jwtIssuer: "cipherpay-server",
  databaseUrl:
    process.env.DATABASE_URL ??
    "mysql://cipherpay:cipherpay@127.0.0.1:3307/cipherpay_server",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  /** Verifying key ID for ZK proofs (e.g. groth16_bn254_v1). Used when storing proofs on messages. */
  verifierKeyId:
    process.env.VERIFIER_KEY_ID ?? "groth16_bn254_v1",
};
