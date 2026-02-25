// Prefer the global browser bundle injected via public/index.html
// Falls back to ESM import if available in the build toolchain.

type SDKShape = {
  TOKENS: Record<string, unknown>;
  bigintifySignals: (s: Record<string, unknown>) => Record<string, bigint>;
  poseidonHash: (inputs: Array<bigint | number | string>) => Promise<bigint>;
  poseidonHashForAuth: (inputs: Array<bigint | number | string>) => Promise<bigint>;
  getAuthPubKeyFromPrivKey?: (privKey: bigint) => Promise<{ x: string; y: string }>;
  signBabyJubPoseidon?: (privKey: bigint, msgField: bigint) => Promise<{ R8x: string; R8y: string; S: string }>;
  commitmentOf: (
    input:
      | Array<bigint | number | string>
      | {
          amount: bigint | number | string;
          tokenId: bigint | number | string;
          ownerCipherPayPubKey: bigint | number | string;
          randomness: { r: bigint | number | string; s?: bigint | number | string };
        }
  ) => Promise<bigint>;
};

let cached: SDKShape | null = null;

export async function getSDK(): Promise<SDKShape> {
  if (cached) return cached;
  if (typeof window !== "undefined" && window.CipherPaySDK) {
    const sdk = window.CipherPaySDK;
    console.log('[SDK] Found window.CipherPaySDK:', typeof sdk);
    
    // CipherPaySDK can be either:
    // 1. A function (class constructor) with utility methods as properties
    // 2. An object with utility methods
    
    if (sdk && (typeof sdk === 'object' || typeof sdk === 'function')) {
      // Check if utility functions are available
      const hasUtils = typeof sdk.poseidonHash === 'function' && 
                       typeof sdk.commitmentOf === 'function';
      
      console.log('[SDK] SDK has utility functions:', hasUtils);
      console.log('[SDK] Available properties:', Object.keys(sdk).filter(k => typeof sdk[k] === 'function'));
      
      if (hasUtils) {
        cached = sdk as unknown as SDKShape;
        console.log('[SDK] Cached SDK, ready to use');
        return cached;
      }
    }
  }
  
  // In browser, we should always use window.CipherPaySDK (loaded via script tag)
  console.error('[SDK] CipherPaySDK not found or missing utility functions');
  console.error('[SDK] window.CipherPaySDK type:', typeof window?.CipherPaySDK);
  console.error('[SDK] Available on window.CipherPaySDK:', window?.CipherPaySDK ? Object.keys(window.CipherPaySDK) : 'null');
  throw new Error(
    "CipherPaySDK not available. Ensure postinstall copied browser bundle to public/sdk and index.html includes it."
  );
}

export async function poseidonHash(inputs: Array<bigint | number | string>) {
  const sdk = await getSDK();
  if (!sdk || typeof sdk.poseidonHash !== 'function') {
    console.error('[SDK] poseidonHash not found. SDK object:', sdk);
    console.error('[SDK] Available keys:', sdk ? Object.keys(sdk) : 'null');
    throw new Error('poseidonHash is not available on CipherPaySDK. Ensure the SDK bundle is loaded correctly.');
  }
  
  // Ensure all inputs are properly formatted before passing to SDK
  // BigInts can lose their type when passed through certain boundaries
  const sanitizedInputs = inputs.map((v) => {
    if (typeof v === 'bigint') {
      return v; // Keep as BigInt
    }
    if (typeof v === 'number') {
      return BigInt(v);
    }
    if (typeof v === 'string') {
      // Handle comma-separated strings (corrupted data)
      if (v.includes(',') && /^\d+(,\d+)+$/.test(v)) {
        const nums = v.split(',').map(x => parseInt(x, 10));
        const hex = nums.map(b => b.toString(16).padStart(2, '0')).join('');
        return BigInt('0x' + hex);
      }
      // Handle hex strings
      if (v.startsWith('0x') || v.startsWith('0X')) {
        return BigInt(v);
      }
      // Try to parse as decimal BigInt string
      try {
        return BigInt(v);
      } catch {
        // If it fails, it might be a corrupted array string
        throw new Error(`Cannot convert string to BigInt: ${v.substring(0, 50)}...`);
      }
    }
    // Handle arrays (shouldn't happen, but be defensive)
    if (Array.isArray(v)) {
      const hex = v.map(b => Number(b).toString(16).padStart(2, '0')).join('');
      return BigInt('0x' + hex);
    }
    // Last resort: try to convert
    try {
      return BigInt(String(v));
    } catch (e) {
      throw new Error(`Cannot convert value to BigInt: ${typeof v} ${String(v).substring(0, 50)}`);
    }
  });
  
  console.log('[SDK] poseidonHash called with inputs:', sanitizedInputs.map((v, i) => {
    const type = typeof v;
    const str = v.toString();
    console.log(`[SDK] Input[${i}]: type=${type}, value=${str.substring(0, 30)}...`);
    return { type, value: str.substring(0, 20) + '...' };
  }));
  
  // Verify all are BigInts before passing to SDK
  const verifiedInputs = sanitizedInputs.map((v, i) => {
    if (typeof v !== 'bigint') {
      console.error(`[SDK] ERROR: Input[${i}] is not a BigInt! Type: ${typeof v}, Value:`, v);
      throw new Error(`Input[${i}] must be a BigInt, got ${typeof v}: ${String(v).substring(0, 50)}`);
    }
    return v;
  });
  
  console.log('[SDK] All inputs verified as BigInt, calling SDK poseidonHash...');
  console.log('[SDK] About to call sdk.poseidonHash with:', verifiedInputs.map((v, i) => ({ i, type: typeof v, isBigInt: typeof v === 'bigint', str: v.toString().substring(0, 20) })));
  
  // Call the SDK function - be very explicit about what we're passing
  try {
    // Ensure we're calling with actual BigInt values, not serialized versions
    const callArgs = verifiedInputs.slice(); // Create a new array to ensure no mutations
    console.log('[SDK] Calling SDK poseidonHash with array of', callArgs.length, 'BigInts');
    const result = await sdk.poseidonHash(callArgs);
    console.log('[SDK] SDK poseidonHash returned:', typeof result, result);
    return result;
  } catch (error) {
    console.error('[SDK] Error in SDK poseidonHash call:', error);
    console.error('[SDK] Error details:', {
      message: error.message,
      inputs: verifiedInputs.map((v, i) => ({ i, type: typeof v, sample: String(v).substring(0, 30) }))
    });
    throw error;
  }
}

export async function commitmentOf(
  input:
    | Array<bigint | number | string>
    | { amount: bigint | number | string; tokenId: bigint | number | string; ownerCipherPayPubKey: bigint | number | string; randomness: { r: bigint | number | string; s?: bigint | number | string } }
) {
  return (await getSDK()).commitmentOf(input);
}

export async function bigintifySignals(s: Record<string, unknown>) {
  return (await getSDK()).bigintifySignals(s);
}

export async function TOKENS() {
  return (await getSDK()).TOKENS;
}

export async function poseidonHashForAuth(inputs: Array<bigint | number | string>) {
  const sdk = await getSDK();
  if (!sdk || typeof sdk.poseidonHashForAuth !== 'function') {
    throw new Error('poseidonHashForAuth is not available on CipherPaySDK. Ensure the SDK bundle is loaded correctly.');
  }
  
  // Sanitize inputs (same as poseidonHash)
  const sanitizedInputs = inputs.map((v) => {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(v);
    if (typeof v === 'string') {
      if (v.includes(',') && /^\d+(,\d+)+$/.test(v)) {
        const nums = v.split(',').map(x => parseInt(x, 10));
        const hex = nums.map(b => b.toString(16).padStart(2, '0')).join('');
        return BigInt('0x' + hex);
      }
      if (v.startsWith('0x') || v.startsWith('0X')) return BigInt(v);
      return BigInt(v);
    }
    if (Array.isArray(v)) {
      const hex = v.map(b => Number(b).toString(16).padStart(2, '0')).join('');
      return BigInt('0x' + hex);
    }
    return BigInt(String(v));
  });
  
  return await sdk.poseidonHashForAuth(sanitizedInputs);
}

export async function getAuthPubKeyFromPrivKey(privKey: bigint): Promise<{ x: string; y: string }> {
  const sdk = await getSDK();
  if (sdk?.getAuthPubKeyFromPrivKey && typeof sdk.getAuthPubKeyFromPrivKey === "function") {
    return sdk.getAuthPubKeyFromPrivKey(privKey);
  }
  throw new Error(
    "getAuthPubKeyFromPrivKey not available on CipherPaySDK. Update the SDK bundle."
  );
}

export async function signBabyJubPoseidon(
  privKey: bigint,
  msgField: bigint
): Promise<{ R8x: string; R8y: string; S: string }> {
  const sdk = await getSDK();
  if (sdk?.signBabyJubPoseidon && typeof sdk.signBabyJubPoseidon === "function") {
    return sdk.signBabyJubPoseidon(privKey, msgField);
  }
  throw new Error(
    "signBabyJubPoseidon not available on CipherPaySDK. Update the SDK bundle."
  );
}
