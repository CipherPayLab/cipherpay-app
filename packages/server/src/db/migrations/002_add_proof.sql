-- Add Groth16 ZK proof columns to messages table for audit/verification
USE `cipherpay_server`;

ALTER TABLE `messages`
  ADD COLUMN `proof_hex` VARCHAR(512) NULL COMMENT 'Groth16 ZK proof (256 bytes as hex)' AFTER `nullifier_hex`,
  ADD COLUMN `proof_public_signals` TEXT NULL COMMENT 'JSON array of public signals' AFTER `proof_hex`;
