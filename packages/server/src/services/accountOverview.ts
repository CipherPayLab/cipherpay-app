// Account Overview Service
// Computes account overview (shielded balance, spendable notes, total notes) from decrypted notes

import { isNullifierSpent } from "./nullifiers.js";
import { computeNullifierBigInt, nullifierToHex } from "./nullifierUtils.js";

/**
 * Note structure (matches cipherpay-sdk/src/types/core.ts)
 */
export interface Note {
  amount: bigint;
  tokenId: bigint;
  ownerCipherPayPubKey: bigint;
  randomness: { r: bigint; s?: bigint };
  memo?: string;
}

/**
 * Account Overview result
 */
export interface AccountOverview {
  shieldedBalance: bigint; // Sum of unspent note amounts
  spendableNotes: number; // Count of notes that haven't been spent
  totalNotes: number; // Total count of notes
  notes: Array<{
    note: Note;
    nullifierHex: string;
    isSpent: boolean;
    amount: bigint;
  }>;
}

/**
 * Compute account overview from decrypted notes.
 * Rule: note is spendable if its nullifier is NOT in nullifiers table with used=1.
 * Rule: note is spent if nullifier exists in nullifiers with used=1.
 * Shielded balance = sum of amounts for spendable notes only.
 */
export async function computeAccountOverview(
  notes: Note[],
  checkOnChain: boolean = false
): Promise<AccountOverview> {
  const results = await Promise.all(
    notes.map(async (note) => {
      const nullifier = await computeNullifierBigInt({
        ownerCipherPayPubKey: note.ownerCipherPayPubKey,
        randomnessR: note.randomness.r,
        tokenId: note.tokenId,
      });
      const nullifierHex = nullifierToHex(nullifier);
      const isSpent = await isNullifierSpent(nullifierHex, checkOnChain);

      return {
        note,
        nullifierHex,
        isSpent,
        amount: note.amount,
      };
    })
  );

  const spendableNotes = results.filter((r) => !r.isSpent && r.amount > 0n);
  const shieldedBalance = spendableNotes.reduce(
    (sum, r) => sum + r.amount,
    0n
  );

  return {
    shieldedBalance,
    spendableNotes: spendableNotes.length,
    totalNotes: notes.length,
    notes: results,
  };
}

