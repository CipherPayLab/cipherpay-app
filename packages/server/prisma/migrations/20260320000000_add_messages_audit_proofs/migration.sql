-- Optional manual migration for `messages` (audit / ZK columns).
-- Prefer: `pnpm db:push` from packages/server — Prisma syncs schema safely.

ALTER TABLE `messages` ADD COLUMN `ciphertext_audit` LONGBLOB NULL;
ALTER TABLE `messages` ADD COLUMN `proof_hex` VARCHAR(512) NULL;
ALTER TABLE `messages` ADD COLUMN `proof_public_signals` TEXT NULL;
ALTER TABLE `messages` ADD COLUMN `verifier_key_id` VARCHAR(64) NOT NULL DEFAULT 'groth16_bn254_v1';
