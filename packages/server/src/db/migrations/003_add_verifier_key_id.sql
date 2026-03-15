-- Add verifier_key_id to messages for deterministic audit verification across circuit upgrades
-- Enables key rotation while preserving ability to verify historical proofs
USE `cipherpay_server`;

ALTER TABLE `messages`
  ADD COLUMN `verifier_key_id` VARCHAR(64) NOT NULL DEFAULT 'groth16_bn254_v1'
    COMMENT 'Verifying key identifier, e.g. transfer_groth16_bn254_vk_0001'
    AFTER `proof_public_signals`;
