import { Identity } from "../types/keys.js";
import { TokenDescriptor, Amount } from "../types/tokens.js";
import { Note } from "../types/core.js";
import { buildNote } from "../notes/note.js";
import { commitmentOf } from "../notes/commitment.js";
import { tokenIdOf } from "../registry/tokenId.js";
import { generateDepositProof } from "../circuits/deposit/prover.js";
import { poseidonHash } from "../crypto/poseidon.js";
import { groth16ProofToHex } from "../utils/zk.js";

export interface DepositParams {
  identity: Identity;
  token: TokenDescriptor;
  amount: Amount;
  recipient?: bigint; // defaults to identity.recipientCipherPayPubKey
  memo?: bigint;
  
  // Server API configuration (UI → Server → Relayer flow)
  serverUrl: string;
  authToken?: string;
  
  // Solana wallet keys as bigints (for circuit inputs)
  ownerWalletPubKey?: bigint;
  ownerWalletPrivKey?: bigint;
  // Nonce for depositHash computation
  nonce?: bigint;
  
  // Delegate mode: source wallet and token account for transfer
  sourceOwner?: string; // Solana wallet address (base58)
  sourceTokenAccount?: string; // Associated token account address (base58)
  useDelegate?: boolean; // If true, relayer will transfer from sourceTokenAccount
  
  // Callback to save note before prepare (for creating encrypted message)
  onNoteReady?: (note: {
    amount: bigint;
    tokenId: bigint;
    ownerCipherPayPubKey: bigint;
    randomness: { r: bigint; s?: bigint };
    memo?: bigint;
    commitment: bigint;
  }) => Promise<void>;
}

export interface DepositResult {
  commitment: bigint;
  index?: number;
  merkleRoot?: bigint;
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

function feFromIndex(idx: number): bigint {
  return BigInt(idx) % FQ;
}

export async function deposit(params: DepositParams): Promise<DepositResult> {
  // 0) First, derive ownerCipherPayPubKey from wallet keys
  // This must match what the circuit computes in NoteCommitmentFromWallet
  const ownerWalletPubKey = params.ownerWalletPubKey ?? BigInt(0);
  const ownerWalletPrivKey = params.ownerWalletPrivKey ?? BigInt(0);
  const nonce = params.nonce ?? feFromIndex(0);
  
  const derivedOwnerCipherPayPubKey = await poseidonHash([
    ownerWalletPubKey,
    ownerWalletPrivKey
  ]);
  
  // 1) Build note & commitment using the DERIVED ownerCipherPayPubKey
  // This ensures the commitment matches what the circuit will compute
  const tokenId = await tokenIdOf(params.token);
  const note: Note = buildNote({
    amount: params.amount.atoms,
    tokenId,
    ownerCipherPayPubKey: derivedOwnerCipherPayPubKey, // ← Use derived key!
    memo: params.memo,
  });
  
  // Compute commitment: H(amount, derivedOwnerCipherPayPubKey, randomness, tokenId, memo)
  const commitment = await commitmentOf(note);

  // 1.5) If callback provided, save note before prepare
  if (params.onNoteReady) {
    await params.onNoteReady({
      amount: note.amount,
      tokenId,
      ownerCipherPayPubKey: derivedOwnerCipherPayPubKey,
      randomness: note.randomness,
      memo: params.memo,
      commitment,
    });
  }

  // 2) Prepare deposit: Call SERVER API to get merkle path
  // Server will forward to relayer
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (params.authToken) {
    headers['Authorization'] = `Bearer ${params.authToken}`;
  }

  const prepareResponse = await fetch(`${params.serverUrl}/api/v1/prepare/deposit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ commitment: commitment.toString() }),
  });

  if (!prepareResponse.ok) {
    const errorText = await prepareResponse.text();
    throw new Error(`Server prepare deposit failed: ${prepareResponse.status} ${errorText}`);
  }

  const prep = await prepareResponse.json() as {
    merkleRoot: string;
    nextLeafIndex: number;
    inPathElements: string[];
    inPathIndices: number[];
  };
  
  // 3) Compute depositHash using the same derived key
  // depositHash = H(ownerCipherPayPubKey, amount, nonce)
  const depositHash = await poseidonHash([
    derivedOwnerCipherPayPubKey,
    params.amount.atoms,
    nonce
  ]);

  // 4) Build circuit inputs (matching test pattern)
  const inputSignals = {
    ownerWalletPubKey: ownerWalletPubKey.toString(),
    ownerWalletPrivKey: ownerWalletPrivKey.toString(),
    randomness: note.randomness.r.toString(),
    tokenId: tokenId.toString(),
    memo: (params.memo ?? 0n).toString(),
    amount: params.amount.atoms.toString(),
    nonce: nonce.toString(),

    inPathElements: prep.inPathElements.map((h) =>
      fromHexToBigBE(h).toString()
    ),
    inPathIndices: prep.inPathIndices,
    nextLeafIndex: prep.nextLeafIndex.toString(),

    oldMerkleRoot: beHexToBig(prep.merkleRoot).toString(),
    depositHash: depositHash.toString(),
  } as any;
  
  // DEBUG: Log all inputs
  console.log('[SDK deposit] Circuit inputs:', {
    derivedOwnerCipherPayPubKey: derivedOwnerCipherPayPubKey.toString(),
    computedCommitment: commitment.toString(),
    computedDepositHash: depositHash.toString(),
    amount: params.amount.atoms.toString(),
    tokenId: tokenId.toString(),
    randomness: note.randomness.r.toString(),
    memo: (params.memo ?? 0n).toString(),
    nonce: nonce.toString(),
  });

  // 5) Generate proof locally in browser
  const { proof, publicSignals } = await generateDepositProof(inputSignals as any);

  // 6) Format hex values for submission
  const commitmentHex = hex64(commitment);
  const depHashHex = hex64(depositHash);
  
  // Use public signals if available (they may have normalized values)
  let finalCommitmentHex = commitmentHex;
  let finalDepHashHex = depHashHex;
  if (publicSignals && Array.isArray(publicSignals) && publicSignals.length >= 7) {
    try {
      finalCommitmentHex = BigInt(publicSignals[0]).toString(16).padStart(64, "0");
      finalDepHashHex = BigInt(publicSignals[5]).toString(16).padStart(64, "0");
    } catch (e) {
      // Fall back to computed values
    }
  }

  // 7) Submit deposit: Call SERVER API to submit proof
  // Server will forward to relayer, which will execute the transaction
  const submitBody: any = {
    operation: 'deposit',
    amount: Number(params.amount.atoms),
    tokenMint: params.token.solana?.mint,
    proof,
    publicSignals: Array.isArray(publicSignals) 
      ? publicSignals.map((s: any) => String(s)) 
      : Object.values(publicSignals).map((s: any) => String(s)),
    depositHash: finalDepHashHex,
    commitment: finalCommitmentHex,
    memo: params.memo ? Number(params.memo) : 0,
  };
  
  // Add delegate mode parameters if provided
  if (params.sourceOwner) {
    submitBody.sourceOwner = params.sourceOwner;
  }
  if (params.sourceTokenAccount) {
    submitBody.sourceTokenAccount = params.sourceTokenAccount;
  }
  if (params.useDelegate !== undefined) {
    submitBody.useDelegate = params.useDelegate;
  }

  const submitResponse = await fetch(`${params.serverUrl}/api/v1/submit/deposit`, {
    method: 'POST',
    headers,
    body: JSON.stringify(submitBody),
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    throw new Error(`Server submit deposit failed: ${submitResponse.status} ${errorText}`);
  }

  const submitResult = await submitResponse.json() as {
    signature?: string;
    txid?: string;
    txSig?: string;
    ok?: boolean;
  };

  const proofHex = groth16ProofToHex(proof as { pi_a: any[]; pi_b: any[][]; pi_c: any[] });
  const proofPublicSignalsArr = Array.isArray(publicSignals)
    ? publicSignals.map((s: any) => String(s))
    : Object.values(publicSignals).map((s: any) => String(s));

  return {
    commitment,
    index: prep.nextLeafIndex,
    merkleRoot: beHexToBig(prep.merkleRoot),
    txId: submitResult.signature || submitResult.txid || submitResult.txSig,
    proofSubmitted: true,
    signature: submitResult.signature || submitResult.txid || submitResult.txSig,
    proofHex,
    proofPublicSignals: proofPublicSignalsArr,
  };
}
