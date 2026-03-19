#!/usr/bin/env node
/**
 * Script to check wSOL balance in the vault PDA's ATA
 * Usage: node check-vault-balance.js [rpc-url] [program-id] [token-mint]
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';

const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const DEFAULT_PROGRAM_ID = new PublicKey('WRy4hstBsD6hxb7CJN4R3fgLnafs621N7EjUhZ2afze');
const VAULT_SEED = Buffer.from('vault');

async function checkVaultBalance(rpcUrl = 'http://127.0.0.1:8899', programId = DEFAULT_PROGRAM_ID, tokenMint = WSOL_MINT) {
  try {
    const connection = new Connection(rpcUrl, 'confirmed');
    
    // Derive vault PDA: [b"vault"]
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [VAULT_SEED],
      programId
    );
    
    // Derive vault ATA: associated token account for the vault PDA
    const vaultAta = getAssociatedTokenAddressSync(
      tokenMint,
      vaultPda,
      true, // allowOwnerOffCurve
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    console.log('Program ID:', programId.toBase58());
    console.log('Token Mint:', tokenMint.toBase58());
    console.log('Vault PDA:', vaultPda.toBase58());
    console.log('Vault ATA:', vaultAta.toBase58());
    console.log('');
    
    // Check if vault ATA exists
    const ataInfo = await connection.getAccountInfo(vaultAta);
    
    if (!ataInfo) {
      console.log('❌ Vault ATA does not exist yet (no tokens deposited)');
      return;
    }
    
    // Get token balance
    try {
      const tokenAccount = await connection.getTokenAccountBalance(vaultAta);
      const balance = Number(tokenAccount.value.amount);
      const decimals = tokenAccount.value.decimals;
      const uiAmount = balance / Math.pow(10, decimals);
      
      console.log('✅ Vault ATA exists');
      console.log('Balance:', balance, 'lamports');
      console.log('Balance:', uiAmount, 'wSOL');
      console.log('Decimals:', decimals);
      
      if (balance > 0) {
        console.log(`\n✅ Vault has ${uiAmount} wSOL!`);
      } else {
        console.log(`\n⚠️  Vault ATA exists but balance is 0`);
      }
    } catch (error) {
      console.log('⚠️  Vault ATA exists but may not be initialized:', error.message);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Get command line arguments
const rpcUrl = process.argv[2] || 'http://127.0.0.1:8899';
const programIdStr = process.argv[3];
const tokenMintStr = process.argv[4];

const programId = programIdStr ? new PublicKey(programIdStr) : DEFAULT_PROGRAM_ID;
const tokenMint = tokenMintStr ? new PublicKey(tokenMintStr) : WSOL_MINT;

checkVaultBalance(rpcUrl, programId, tokenMint);

