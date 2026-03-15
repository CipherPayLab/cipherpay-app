import { Identity } from "../types/keys.js";
import { TokenDescriptor, Amount } from "../types/tokens.js";
import { Note } from "../types/core.js";
import { buildNote } from "../notes/note.js";
import { commitmentOf } from "../notes/commitment.js";
import { tokenIdOf } from "../registry/tokenId.js";
import { generateTransferProof } from "../circuits/transfer/prover.js";
import { poseidonHash } from "../crypto/poseidon.js";
import { groth16ProofToHex } from "../utils/zk.js";

export interface TransferParams {
  identity: Identity;
  
  // Input note (spent note)
  inputNote: Note;
  inputNoteIndex?: number; // Optional: if known, can skip lookup
  
  // Output notes (two notes created from the transfer)
  out1: {
    amount: Amount;
    recipientCipherPayPubKey: bigint; // Recipient's ownerCipherPayPubKey
    token: TokenDescriptor;
    memo?: bigint;
  };
  out2: {
    amount: Amount;
    recipientCipherPayPubKey: bigint; // Recipient's ownerCipherPayPubKey (can be same as out1 for change)
    token: TokenDescriptor;
    memo?: bigint;
  };
  
  // Server API configuration (UI → Server → Relayer flow)
  serverUrl: string;
  authToken?: string;
  
  // Solana wallet keys as bigints (for circuit inputs)
  ownerWalletPubKey?: bigint;
  ownerWalletPrivKey?: bigint;
  
  // Callbacks to save encrypted notes before prepare
  onOut1NoteReady?: (note: {
    amount: bigint;
    tokenId: bigint;
    ownerCipherPayPubKey: bigint;
    randomness: { r: bigint; s?: bigint };
    memo?: bigint;
    commitment: bigint;
  }) => Promise<void>;
  onOut2NoteReady?: (note: {
    amount: bigint;
    tokenId: bigint;
    ownerCipherPayPubKey: bigint;
    randomness: { r: bigint; s?: bigint };
    memo?: bigint;
    commitment: bigint;
  }) => Promise<void>;
}

export interface TransferResult {
  out1Commitment: bigint;
  out2Commitment: bigint;
  nullifier: bigint;
  oldMerkleRoot: bigint;
  newMerkleRoot1?: bigint;
  newMerkleRoot2?: bigint;
  newNextLeafIndex?: number;
  txId?: string;
  proofSubmitted?: boolean;
  signature?: string;
  /** Groth16 proof as hex string (256 bytes = 512 hex chars) for storage/audit */
  proofHex?: string;
  /** Public signals as string array for storage/audit */
  proofPublicSignals?: string[];
}

// Field modulus for BN254
const FQ = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function normalizeHex(h: string): string {
  return (h.startsWith("0x") ? h.slice(2) : h).toLowerCase();
}

function beHexToBig(h: string): bigint {
  return BigInt("0x" + normalizeHex(h));
}

function fromHexToBigBE(s: string): bigint {
  const t = s.startsWith("0x") ? s.slice(2) : s;
  return BigInt("0x" + t) % FQ;
}

function hex64(bi: bigint): string {
  return bi.toString(16).padStart(64, "0");
}

function modF(x: bigint): bigint {
  return ((x % FQ) + FQ) % FQ;
}

/**
 * Synthesize out2PathElements following transfer.circom Step 8 logic
 * This matches the test file's synthesizeOut2PathElementsBE function
 */
function synthesizeOut2PathElementsBE(
  depth: number,
  nextLeafIndex: number,
  out1PathElementsBE: string[],
  out2PathElementsBE_pre: string[],
  cur1Nodes: bigint[], // cur1[k] after step-7; length depth+1
  out1Commitment: bigint
): string[] {
  const bits1 = Array.from(
    { length: depth },
    (_, i) => (nextLeafIndex >> i) & 1
  );
  const out: string[] = new Array(depth);

  // k = 0 special case (sib0 = out1 if nextLeafIndex even; else pre-sibling)
  const b0 = bits1[0]; // 0 if even
  out[0] =
    b0 === 0
      ? "0x" + modF(out1Commitment).toString(16).padStart(64, "0")
      : out2PathElementsBE_pre[0];

  // Levels k >= 1:
  // replace_k = (all lower bits of nextLeafIndex are 1) * (this bit is 0)
  let carry = 1;
  for (let k = 1; k < depth; k++) {
    carry = carry * (bits1[k - 1] ? 1 : 0);
    const replaceK = carry * (bits1[k] ? 0 : 1);
    out[k] =
      replaceK === 1
        ? "0x" + modF(cur1Nodes[k]).toString(16).padStart(64, "0")
        : out2PathElementsBE_pre[k];
  }
  return out;
}

export async function transfer(params: TransferParams): Promise<TransferResult> {
  // 0) Derive sender's ownerCipherPayPubKey from wallet keys (must match input note)
  const ownerWalletPubKey = params.ownerWalletPubKey ?? BigInt(0);
  const ownerWalletPrivKey = params.ownerWalletPrivKey ?? BigInt(0);
  
  const senderCipherPayPubKey = await poseidonHash([
    ownerWalletPubKey,
    ownerWalletPrivKey
  ]);
  
  // Validate that input note's ownerCipherPayPubKey matches derived key
  if (params.inputNote.ownerCipherPayPubKey !== senderCipherPayPubKey) {
    throw new Error(
      `Input note ownerCipherPayPubKey mismatch: expected ${senderCipherPayPubKey}, got ${params.inputNote.ownerCipherPayPubKey}`
    );
  }

  // 1) Build output notes
  const out1TokenId = await tokenIdOf(params.out1.token);
  const out1Note: Note = buildNote({
    amount: params.out1.amount.atoms,
    tokenId: out1TokenId,
    ownerCipherPayPubKey: params.out1.recipientCipherPayPubKey,
    memo: params.out1.memo,
  });
  
  const out2TokenId = await tokenIdOf(params.out2.token);
  const out2Note: Note = buildNote({
    amount: params.out2.amount.atoms,
    tokenId: out2TokenId,
    ownerCipherPayPubKey: params.out2.recipientCipherPayPubKey,
    memo: params.out2.memo,
  });

  // 2) Compute commitments
  const inCommitment = await commitmentOf(params.inputNote);
  const out1Commitment = await commitmentOf(out1Note);
  const out2Commitment = await commitmentOf(out2Note);
  

  // 3) Compute nullifier: H(senderCipherPayPubKey, inRandomness, inTokenId)
  // This matches the NullifierFromCipherKey circuit: Poseidon(cipherPayPubKey, randomness, tokenId)
  const nullifier = await poseidonHash([
    senderCipherPayPubKey,
    params.inputNote.randomness.r,
    params.inputNote.tokenId
  ]);

  // 4) Callbacks to save encrypted notes before prepare
  if (params.onOut1NoteReady) {
    await params.onOut1NoteReady({
      amount: out1Note.amount,
      tokenId: out1TokenId,
      ownerCipherPayPubKey: params.out1.recipientCipherPayPubKey,
      randomness: out1Note.randomness,
      memo: params.out1.memo,
      commitment: out1Commitment,
    });
  }
  
  if (params.onOut2NoteReady) {
    await params.onOut2NoteReady({
      amount: out2Note.amount,
      tokenId: out2TokenId,
      ownerCipherPayPubKey: params.out2.recipientCipherPayPubKey,
      randomness: out2Note.randomness,
      memo: params.out2.memo,
      commitment: out2Commitment,
    });
  }

  // 5) Prepare transfer: Call SERVER API to get merkle paths
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (params.authToken) {
    headers['Authorization'] = `Bearer ${params.authToken}`;
  }

  const prepareResponse = await fetch(`${params.serverUrl}/api/v1/prepare/transfer`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ inCommitment: inCommitment.toString() }),
  });

  if (!prepareResponse.ok) {
    const errorText = await prepareResponse.text();
    throw new Error(`Server prepare transfer failed: ${prepareResponse.status} ${errorText}`);
  }

  const prep = await prepareResponse.json() as {
    merkleRoot: string; // BE hex
    inPathElements: string[]; // BE hex (bottom→top)
    inPathIndices: number[]; // 0/1 bits, LSB at level 0
    leafIndex: number; // index where inCommitment lives
    nextLeafIndex: number; // index for out1
    out1PathElements: string[]; // BE hex siblings for out1 position
    out2PathElements: string[]; // BE hex siblings for out2 position (pre-state)
  };

  // 6) Verify old root locally from the spent leaf
  const depth = prep.inPathElements.length;
  let cur = modF(inCommitment);
  for (let i = 0; i < depth; i++) {
    const sib = fromHexToBigBE(prep.inPathElements[i]);
    cur = prep.inPathIndices[i] === 0
      ? await poseidonHash([modF(cur), modF(sib)])
      : await poseidonHash([modF(sib), modF(cur)]);
    cur = modF(cur);
  }
  const localOldRoot = cur;
  const localBE = hex64(localOldRoot);
  const prepareBE = normalizeHex(prep.merkleRoot);
  
  if (localBE !== prepareBE) {
    throw new Error(
      `oldMerkleRoot mismatch (BE): local=${localBE} prepare=${prepareBE} (leafIndex=${prep.leafIndex})`
    );
  }

  // 7) Rebuild Step 7 in JS to obtain cur1[k] nodes (needed for synth at k>=1)
  const bits1 = Array.from(
    { length: depth },
    (_, i) => (prep.nextLeafIndex >> i) & 1
  );
  const cur1: bigint[] = new Array(depth + 1);
  cur1[0] = modF(out1Commitment);

  for (let j = 0; j < depth; j++) {
    const sib = fromHexToBigBE((prep.out1PathElements || [])[j] || "0");
    const left = bits1[j] ? sib : cur1[j];
    const right = bits1[j] ? cur1[j] : sib;
    cur1[j + 1] = modF(await poseidonHash([modF(left), modF(right)]));
  }

  // 8) Synthesize out2PathElements exactly like Step 8 in circom
  const out2BE_pre = prep.out2PathElements || new Array(depth).fill("0");
  const out2BE_synth = synthesizeOut2PathElementsBE(
    depth,
    prep.nextLeafIndex,
    prep.out1PathElements || [],
    out2BE_pre,
    cur1,
    out1Commitment
  );

  // 9) Compute enc note tags: Poseidon(commitment, recipientPk)
  const encNote1Hash = await poseidonHash([modF(out1Commitment), modF(params.out1.recipientCipherPayPubKey)]);
  const encNote2Hash = await poseidonHash([modF(out2Commitment), modF(params.out2.recipientCipherPayPubKey)]);

  // 10) Build circuit inputs (decimal strings; siblings parsed as BE bigints)
  // Defensive conversion: ensure all input note fields are BigInt (like deposit.ts does)
  const toBigInt = (val: any): bigint => {
    if (typeof val === 'bigint') return val;
    if (typeof val === 'string' && val.startsWith('0x')) return BigInt(val);
    if (typeof val === 'number') return BigInt(val);
    return BigInt(val);
  };
  
  const inAmount = toBigInt(params.inputNote.amount);
  const inTokenId = toBigInt(params.inputNote.tokenId);
  const inRandomnessR = toBigInt(params.inputNote.randomness.r);
  const inMemo = params.inputNote.memo ? toBigInt(params.inputNote.memo) : 0n;
  
  const inAmountStr = modF(inAmount).toString();
  const inTokenIdStr = modF(inTokenId).toString();
  const inRandomnessStr = modF(inRandomnessR).toString();
  const inMemoStr = modF(inMemo).toString();
  
  // Build inputSignals object (matching test pattern exactly)
  const inputSignals: Record<string, any> = {
    // input note
    inAmount: inAmountStr,
    inSenderWalletPubKey: modF(ownerWalletPubKey).toString(),
    inSenderWalletPrivKey: modF(ownerWalletPrivKey).toString(),
    inRandomness: inRandomnessStr,
    inTokenId: inTokenIdStr,
    inMemo: inMemoStr,

    // outputs
    out1Amount: modF(out1Note.amount).toString(),
    out1RecipientCipherPayPubKey: modF(params.out1.recipientCipherPayPubKey).toString(),
    out1Randomness: modF(out1Note.randomness.r).toString(),
    out1TokenId: modF(out1TokenId).toString(),
    out1Memo: modF(params.out1.memo ?? 0n).toString(),

    out2Amount: modF(out2Note.amount).toString(),
    out2RecipientCipherPayPubKey: modF(params.out2.recipientCipherPayPubKey).toString(),
    out2Randomness: modF(out2Note.randomness.r).toString(),
    out2TokenId: modF(out2TokenId).toString(),
    out2Memo: modF(params.out2.memo ?? 0n).toString(),

    // merkle proof of spent note
    inPathElements: prep.inPathElements.map((h) =>
      fromHexToBigBE(h).toString()
    ),
    inPathIndices: prep.inPathIndices,
    nextLeafIndex: String(prep.nextLeafIndex),

    // insertion siblings
    out1PathElements: (prep.out1PathElements || new Array(depth).fill("0")).map((h) =>
      fromHexToBigBE(h).toString()
    ),
    out2PathElements: out2BE_synth.map((h) => fromHexToBigBE(h).toString()),

    // required extra bindings (POSEIDON2(commitment, pk))
    encNote1Hash: modF(encNote1Hash).toString(),
    encNote2Hash: modF(encNote2Hash).toString(),
  };

  // Normalize input signals (convert any hex strings to decimal, matching test pattern exactly)
  // Create a completely fresh object with only the expected keys to avoid any prototype issues
  const toDecimalIfHex = (x: any): any => {
    if (typeof x === "string") {
      const s = x.trim();
      if (/^0x[0-9a-fA-F]+$/.test(s)) return BigInt(s).toString();
      if (/^[0-9]+$/.test(s)) return s; // keep decimal as-is
      return s;
    }
    if (typeof x === "number") return x; // Keep numbers as-is (for inPathIndices)
    if (typeof x === "bigint") return x.toString();
    if (Array.isArray(x)) return x.map(toDecimalIfHex);
    return x;
  };

  // Build a completely fresh object with only the expected keys (matching test pattern exactly)
  // This avoids any prototype chain or hidden property issues
  const normalizedInput: Record<string, any> = {
    // input note (all as decimal strings)
    inAmount: toDecimalIfHex(inputSignals.inAmount),
    inSenderWalletPubKey: toDecimalIfHex(inputSignals.inSenderWalletPubKey),
    inSenderWalletPrivKey: toDecimalIfHex(inputSignals.inSenderWalletPrivKey),
    inRandomness: toDecimalIfHex(inputSignals.inRandomness),
    inTokenId: toDecimalIfHex(inputSignals.inTokenId),
    inMemo: toDecimalIfHex(inputSignals.inMemo),

    // outputs (all as decimal strings)
    out1Amount: toDecimalIfHex(inputSignals.out1Amount),
    out1RecipientCipherPayPubKey: toDecimalIfHex(inputSignals.out1RecipientCipherPayPubKey),
    out1Randomness: toDecimalIfHex(inputSignals.out1Randomness),
    out1TokenId: toDecimalIfHex(inputSignals.out1TokenId),
    out1Memo: toDecimalIfHex(inputSignals.out1Memo),

    out2Amount: toDecimalIfHex(inputSignals.out2Amount),
    out2RecipientCipherPayPubKey: toDecimalIfHex(inputSignals.out2RecipientCipherPayPubKey),
    out2Randomness: toDecimalIfHex(inputSignals.out2Randomness),
    out2TokenId: toDecimalIfHex(inputSignals.out2TokenId),
    out2Memo: toDecimalIfHex(inputSignals.out2Memo),

    // merkle proof (arrays)
    inPathElements: toDecimalIfHex(inputSignals.inPathElements),
    inPathIndices: inputSignals.inPathIndices, // Keep as numbers array (not normalized)
    nextLeafIndex: toDecimalIfHex(inputSignals.nextLeafIndex),

    // insertion siblings (arrays of decimal strings)
    out1PathElements: toDecimalIfHex(inputSignals.out1PathElements),
    out2PathElements: toDecimalIfHex(inputSignals.out2PathElements),

    // required extra bindings (decimal strings)
    encNote1Hash: toDecimalIfHex(inputSignals.encNote1Hash),
    encNote2Hash: toDecimalIfHex(inputSignals.encNote2Hash),
  };
  
  // Create a completely clean, plain object with NO prototype chain
  // Use Object.create(null) to ensure absolutely no inherited properties
  const cleanInput: Record<string, any> = Object.create(null);
  
  // Explicitly copy each field to the clean object
  cleanInput.inAmount = normalizedInput.inAmount;
  cleanInput.inSenderWalletPubKey = normalizedInput.inSenderWalletPubKey;
  cleanInput.inSenderWalletPrivKey = normalizedInput.inSenderWalletPrivKey;
  cleanInput.inRandomness = normalizedInput.inRandomness;
  cleanInput.inTokenId = normalizedInput.inTokenId;
  cleanInput.inMemo = normalizedInput.inMemo;
  
  cleanInput.out1Amount = normalizedInput.out1Amount;
  cleanInput.out1RecipientCipherPayPubKey = normalizedInput.out1RecipientCipherPayPubKey;
  cleanInput.out1Randomness = normalizedInput.out1Randomness;
  cleanInput.out1TokenId = normalizedInput.out1TokenId;
  cleanInput.out1Memo = normalizedInput.out1Memo;
  
  cleanInput.out2Amount = normalizedInput.out2Amount;
  cleanInput.out2RecipientCipherPayPubKey = normalizedInput.out2RecipientCipherPayPubKey;
  cleanInput.out2Randomness = normalizedInput.out2Randomness;
  cleanInput.out2TokenId = normalizedInput.out2TokenId;
  cleanInput.out2Memo = normalizedInput.out2Memo;
  
  cleanInput.inPathElements = normalizedInput.inPathElements;
  cleanInput.inPathIndices = normalizedInput.inPathIndices;
  cleanInput.nextLeafIndex = normalizedInput.nextLeafIndex;
  cleanInput.out1PathElements = normalizedInput.out1PathElements;
  cleanInput.out2PathElements = normalizedInput.out2PathElements;
  cleanInput.encNote1Hash = normalizedInput.encNote1Hash;
  cleanInput.encNote2Hash = normalizedInput.encNote2Hash;

  // 11) Generate proof locally in browser (pass clean input directly, matching test pattern)
  const { proof, publicSignals } = await generateTransferProof(cleanInput as any);

  // 12) Format hex values for submission (BE hex)
  const oldRootHex = normalizeHex(prep.merkleRoot);
  
  // Public signals order: OUT1, OUT2, NULLIFIER, MERKLE_ROOT, NEW_ROOT1, NEW_ROOT2, NEW_NEXT_IDX, ENC1, ENC2
  const PS = {
    OUT1: 0,
    OUT2: 1,
    NULLIFIER: 2,
    MERKLE_ROOT: 3,
    NEW_ROOT1: 4,
    NEW_ROOT2: 5,
    NEW_NEXT_IDX: 6,
    ENC1: 7,
    ENC2: 8,
  } as const;

  // Helper to extract public signal value (handles both array and object formats)
  const getPublicSignal = (index: number): string | bigint | number | undefined => {
    if (Array.isArray(publicSignals)) {
      return publicSignals[index];
    }
    // Try numeric index first
    if (typeof publicSignals[index] !== 'undefined') {
      return publicSignals[index];
    }
    // Try string key
    const key = Object.keys(publicSignals)[index];
    return key ? publicSignals[key] : undefined;
  };

  const getHex = (i: number): string => {
    const val = getPublicSignal(i);
    if (val === undefined) return "";
    return BigInt(val).toString(16).padStart(64, "0");
  };

  const hasPublicSignals = Array.isArray(publicSignals) ? publicSignals.length > 0 : Object.keys(publicSignals).length > 0;

  // 13) Submit transfer: Call SERVER API to submit proof
  const submitBody: any = {
    operation: "transfer",
    tokenMint: params.out1.token.solana?.mint || params.out2.token.solana?.mint,

    // zk
    proof,
    publicSignals: Array.isArray(publicSignals)
      ? publicSignals.map((s: any) => String(s))
      : Object.values(publicSignals).map((s: any) => String(s)),

    // canonical pubs we (also) send explicitly (BE hex)
    out1Commitment: hasPublicSignals
      ? getHex(PS.OUT1)
      : hex64(out1Commitment),
    out2Commitment: hasPublicSignals
      ? getHex(PS.OUT2)
      : hex64(out2Commitment),
    nullifier: hasPublicSignals ? getHex(PS.NULLIFIER) : hex64(nullifier),
    oldMerkleRoot: hasPublicSignals ? getHex(PS.MERKLE_ROOT) : oldRootHex,
    newMerkleRoot1: hasPublicSignals ? getHex(PS.NEW_ROOT1) : undefined,
    newMerkleRoot2: hasPublicSignals ? getHex(PS.NEW_ROOT2) : undefined,
    newNextLeafIndex: hasPublicSignals
      ? (() => {
          const val = getPublicSignal(PS.NEW_NEXT_IDX);
          return val !== undefined ? String(BigInt(val)) : undefined;
        })()
      : undefined,

    // for server-side accounting / checks
    inAmount: Number(params.inputNote.amount),
    out1Amount: Number(out1Note.amount),
    out2Amount: Number(out2Note.amount),
  };

  const submitResponse = await fetch(`${params.serverUrl}/api/v1/submit/transfer`, {
    method: 'POST',
    headers,
    body: JSON.stringify(submitBody),
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    throw new Error(`Server submit transfer failed: ${submitResponse.status} ${errorText}`);
  }

  const submitResult = await submitResponse.json() as {
    signature?: string;
    txid?: string;
    txSig?: string;
    ok?: boolean;
    root1?: string;
    root2?: string;
  };

  const proofHex = groth16ProofToHex(proof as { pi_a: any[]; pi_b: any[][]; pi_c: any[] });
  const proofPublicSignalsArr = Array.isArray(publicSignals)
    ? publicSignals.map((s: any) => String(s))
    : Object.values(publicSignals).map((s: any) => String(s));

  return {
    out1Commitment,
    out2Commitment,
    nullifier,
    oldMerkleRoot: beHexToBig(prep.merkleRoot),
    newMerkleRoot1: submitResult.root1 ? beHexToBig(submitResult.root1) : undefined,
    newMerkleRoot2: submitResult.root2 ? beHexToBig(submitResult.root2) : undefined,
    newNextLeafIndex: submitResult.root1 ? prep.nextLeafIndex + 2 : undefined,
    txId: submitResult.signature || submitResult.txid || submitResult.txSig,
    proofSubmitted: true,
    signature: submitResult.signature || submitResult.txid || submitResult.txSig,
    proofHex,
    proofPublicSignals: proofPublicSignalsArr,
  };
}
