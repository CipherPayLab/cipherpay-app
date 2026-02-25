/**
 * BabyJub/EdDSA helpers for authentication.
 * Uses circomlibjs bundled in the SDK (works in production) instead of
 * the UI's Vite-bundled copy which can fail with ge.ready errors.
 */

let _babyJub: any = null;
let _eddsa: any = null;

async function loadBabyJubEddsa(): Promise<{ babyJub: any; eddsa: any }> {
  if (_babyJub && _eddsa) return { babyJub: _babyJub, eddsa: _eddsa };

  const mod: any = await import("circomlibjs");

  const buildBabyjub =
    mod.buildBabyjub || mod.buildBabyJub || mod.default?.buildBabyjub || mod.default?.buildBabyJub;
  if (!buildBabyjub || typeof buildBabyjub !== "function") {
    throw new Error("circomlibjs: buildBabyjub not available");
  }
  _babyJub = await buildBabyjub();

  const buildEddsa =
    mod.buildEddsa ||
    mod.eddsa?.buildEddsa ||
    mod.default?.buildEddsa ||
    mod.default?.eddsa?.buildEddsa;
  if (!buildEddsa || typeof buildEddsa !== "function") {
    throw new Error("circomlibjs: buildEddsa not available");
  }
  _eddsa = await buildEddsa();

  return { babyJub: _babyJub, eddsa: _eddsa };
}

function bigIntToBytes32LE(n: bigint): Uint8Array {
  const buf = new Uint8Array(32);
  let temp = n;
  for (let i = 0; i < 32; i++) {
    buf[i] = Number(temp & 0xffn);
    temp = temp >> 8n;
  }
  return buf;
}

export interface AuthPubKey {
  x: string;
  y: string;
}

export interface BabyJubSignature {
  R8x: string;
  R8y: string;
  S: string;
}

/**
 * Derive BabyJub EdDSA public key from private key (bigint).
 * Used for auth registration/challenge.
 */
export async function getAuthPubKeyFromPrivKey(privKey: bigint): Promise<AuthPubKey> {
  const { babyJub, eddsa } = await loadBabyJubEddsa();
  const F = babyJub.F;
  const privKeyBytes = bigIntToBytes32LE(privKey);
  const pk = eddsa.prv2pub(privKeyBytes);
  const x = "0x" + F.toObject(pk[0]).toString(16).padStart(64, "0");
  const y = "0x" + F.toObject(pk[1]).toString(16).padStart(64, "0");
  return { x, y };
}

/**
 * Sign a message field (bigint) with BabyJub EdDSA.
 * Used for auth challenge response.
 */
export async function signBabyJubPoseidon(
  privKey: bigint,
  msgField: bigint
): Promise<BabyJubSignature> {
  const { babyJub, eddsa } = await loadBabyJubEddsa();
  const F = babyJub.F;
  const privKeyBytes = bigIntToBytes32LE(privKey);
  const msgFieldElem = F.e(msgField);
  const sig = eddsa.signPoseidon(privKeyBytes, msgFieldElem);

  const toHex = (v: any): string => {
    if (typeof v === "bigint") return "0x" + v.toString(16).padStart(64, "0");
    if (F && typeof F.toObject === "function") {
      try {
        const obj = F.toObject(v);
        return "0x" + obj.toString(16).padStart(64, "0");
      } catch {
        /* fall through */
      }
    }
    if (v instanceof Uint8Array)
      return "0x" + Array.from(v)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    return "0x" + String(v);
  };

  return {
    R8x: toHex(sig.R8[0]),
    R8y: toHex(sig.R8[1]),
    S: toHex(sig.S),
  };
}
