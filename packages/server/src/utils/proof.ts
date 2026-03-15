/**
 * Server-side Groth16 proof utilities for persisting ZK proofs in the database.
 * Matches the encoding used by the SDK's groth16ProofToHex in packages/sdk/src/utils/zk.ts.
 */

export interface Groth16Proof {
  pi_a: unknown[];
  pi_b: unknown[][];
  pi_c: unknown[];
}

/**
 * Encodes a Groth16 proof as 512-character hex string (256 bytes, no 0x prefix).
 * Layout: pi_a[0], pi_a[1], pi_b[0][0], pi_b[0][1], pi_b[1][0], pi_b[1][1], pi_c[0], pi_c[1]
 * Each field element is serialized as a big-endian 32-byte integer.
 */
export function groth16ProofToHex(proof: Groth16Proof): string {
  const toBI = (v: unknown): bigint => BigInt(String(v));
  const beBytes32 = (x: bigint): Uint8Array => {
    const out = new Uint8Array(32);
    let v = x;
    for (let i = 31; i >= 0; i--) {
      out[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    return out;
  };

  const parts: bigint[] = [
    toBI(proof.pi_a[0]),
    toBI(proof.pi_a[1]),
    toBI((proof.pi_b[0] as unknown[])[0]),
    toBI((proof.pi_b[0] as unknown[])[1]),
    toBI((proof.pi_b[1] as unknown[])[0]),
    toBI((proof.pi_b[1] as unknown[])[1]),
    toBI(proof.pi_c[0]),
    toBI(proof.pi_c[1]),
  ];

  const total = new Uint8Array(parts.length * 32);
  parts.map(beBytes32).forEach((b, i) => total.set(b, i * 32));
  return Array.from(total)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Strip leading 0x and left-pad to 64 hex chars. */
export function normalizeHex64(hex: string): string {
  return hex.replace(/^0x/i, "").toLowerCase().padStart(64, "0");
}

/** Serialise public signals array to the JSON string stored in proof_public_signals. */
export function serializePublicSignals(signals: unknown[]): string {
  return JSON.stringify(signals.map((s) => String(s)));
}
