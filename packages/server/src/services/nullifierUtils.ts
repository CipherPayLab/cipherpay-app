import { poseidonHash } from "@cipherpay/sdk";

const normalizeHex = (value: string) => {
  if (!value) throw new Error("Hex value is required");
  return value.startsWith("0x") ? value.slice(2) : value;
};

const toBigInt = (value: string | number | bigint) => {
  if (typeof value === "bigint") return value;
  if (typeof value === "string") {
    const hex = value.startsWith("0x") ? value : `0x${value}`;
    return BigInt(hex);
  }
  if (typeof value === "number") {
    return BigInt(value);
  }
  throw new Error("Unsupported value for BigInt conversion");
};

export async function computeNullifierBigInt(params: {
  ownerCipherPayPubKey: string | bigint;
  randomnessR: string | number | bigint;
  tokenId: string | number | bigint;
}): Promise<bigint> {
  const ownerKey = toBigInt(params.ownerCipherPayPubKey);
  const randomnessR = toBigInt(params.randomnessR);
  const tokenId = toBigInt(params.tokenId);

  return poseidonHash([ownerKey, randomnessR, tokenId]);
}

/**
 * Encode nullifier as 32-byte big-endian hex (64 chars, lowercase, no 0x).
 * Must match nullifier_hex format in DB and nullifiers table for isNullifierSpent lookup.
 */
export function nullifierToHex(nullifier: bigint): string {
  const buf = Buffer.alloc(32);
  let value = nullifier;
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return buf.toString("hex").toLowerCase();
}

/**
 * Normalize nullifier hex for consistent DB lookup.
 * Ensures lowercase, no 0x, and exactly 64 chars (pads leading zeros if needed).
 */
export function normalizeNullifierHex(hex: string): string {
  const cleaned = hex.replace(/^0x/i, "").toLowerCase();
  return cleaned.padStart(64, "0").slice(0, 64);
}

export function normalizeOwnerCipherPayKey(value: string): string {
  const normalized = value.toLowerCase();
  return normalized.startsWith("0x") ? normalized : `0x${normalized}`;
}

