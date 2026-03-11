export interface CipherPayMessage {
  recipientKey: string;
  senderKey?: string;
  kind: "note-transfer" | "note-deposit" | "note-message" | "note-withdraw";
  ciphertext: string; // base64
  contentHash: string; // Poseidon(recipientKey, ciphertext)
  proofHex?: string | null; // Groth16 proof (256 bytes as hex)
  proofPublicSignals?: string[] | null; // Public signals for verification
  verifierKeyId?: string | null; // Verifying key ID for audit (e.g. groth16_bn254_v1)
  createdAt?: string;
}
