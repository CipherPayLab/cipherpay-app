import { z } from "zod";
function toBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") {
    const s = v.trim();
    return BigInt(s.startsWith("0x") ? s : BigInt(s));
  }
  if (v && typeof (v as any).toString === "function") return BigInt((v as any).toString());
  throw new TypeError(`toBigInt: unsupported ${typeof v}`);
}

export const DepositSignalsZ = z.object({
  amount: z.union([z.string(), z.number(), z.bigint()]),
  depositHash: z.union([z.string(), z.number(), z.bigint()]),
  newCommitment: z.union([z.string(), z.number(), z.bigint()]),
  ownerCipherPayPubKey: z.union([z.string(), z.number(), z.bigint()]),
  merkleRoot: z.union([z.string(), z.number(), z.bigint()]),
  nextLeafIndex: z.union([z.string(), z.number()]),
});

export type DepositSignals = z.infer<typeof DepositSignalsZ>;

export function bigintifySignals<T extends Record<string, unknown>>(s: T): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "nextLeafIndex") continue; // u32 separately
    out[k] = toBigInt(v);
  }
  return out;
}

/** Convert snarkjs Groth16 proof to hex string (256 bytes = 512 hex chars). */
export function groth16ProofToHex(proof: { pi_a: any[]; pi_b: any[][]; pi_c: any[] }): string {
  const toBI = (v: any) => BigInt(v.toString());
  const beBytes32 = (x: bigint): Uint8Array => {
    const out = new Uint8Array(32);
    let v = x;
    for (let i = 31; i >= 0; i--) {
      out[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    return out;
  };
  const parts = [
    toBI(proof.pi_a[0]), toBI(proof.pi_a[1]),
    toBI(proof.pi_b[0][0]), toBI(proof.pi_b[0][1]),
    toBI(proof.pi_b[1][0]), toBI(proof.pi_b[1][1]),
    toBI(proof.pi_c[0]), toBI(proof.pi_c[1]),
  ];
  const bytes = parts.map(beBytes32);
  const total = new Uint8Array(bytes.length * 32);
  bytes.forEach((b, i) => total.set(b, i * 32));
  return Array.from(total).map((b) => b.toString(16).padStart(2, "0")).join("");
}
