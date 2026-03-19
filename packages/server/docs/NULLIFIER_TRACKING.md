# Nullifier Tracking System

## Overview

This system tracks which notes have been spent by maintaining a database of nullifiers and syncing with on-chain `NullifierRecord` PDAs from the `cipherpay-anchor` program.

## Architecture

### Database Schema

**`nullifiers` table:**
- `nullifier` (BINARY(32)): The 32-byte nullifier value
- `nullifier_hex` (CHAR(64)): Hex representation for easy querying
- `pda_address` (VARCHAR(44)): Solana PDA address for this nullifier
- `used` (BOOLEAN): Whether the nullifier is spent on-chain
- `tx_signature` (VARCHAR(88)): Transaction signature that spent it
- `event_type` (VARCHAR(24)): 'transfer' or 'withdraw'
- `spent_at` (TIMESTAMP): When it was spent (from on-chain)
- `synced_at` (TIMESTAMP): Last sync time with on-chain

**`tx` table enhancement:**
- Added `nullifier_hex` column to link transactions with nullifiers

### On-Chain Structure

The `cipherpay-anchor` program stores nullifiers as PDAs:
- **Seeds**: `[b"nullifier", nullifier_bytes]`
- **Account**: `NullifierRecord` with fields:
  - `used: bool` - Whether the nullifier has been spent
  - `bump: u8` - PDA bump seed

### Sync Process

1. **Database First**: Check local database for nullifier status
2. **On-Chain Verification**: Query Solana RPC for `NullifierRecord` PDA
3. **Update Database**: Store/update nullifier status in database
4. **Batch Processing**: Sync multiple nullifiers efficiently

## API Endpoints

### `POST /api/v1/nullifiers/sync`
Sync all nullifiers for the authenticated user.

**Response:**
```json
{
  "ok": true,
  "synced": 5,
  "failed": 0,
  "message": "Synced 5 nullifiers, 0 failed"
}
```

### `POST /api/v1/nullifiers/sync/:nullifierHex`
Sync a specific nullifier by hex string.

**Parameters:**
- `nullifierHex`: 64-character hex string (32 bytes)

**Response:**
```json
{
  "ok": true,
  "message": "Nullifier synced successfully"
}
```

### `GET /api/v1/nullifiers/check/:nullifierHex?checkOnChain=true`
Check if a nullifier is spent.

**Query Parameters:**
- `checkOnChain` (optional): If true, check on-chain if not in database

**Response:**
```json
{
  "ok": true,
  "nullifierHex": "abc123...",
  "spent": true
}
```

## Usage Flow

### For Account Overview

1. **Decrypt Notes**: Decrypt `messages.ciphertext` for the user to get all notes
2. **Extract Nullifiers**: Compute nullifier for each note (from note's private key)
3. **Check Status**: Use `isNullifierSpent()` to check if each nullifier is spent
4. **Calculate Metrics**:
   - **Shielded Balance**: Sum of amounts from unspent notes
   - **Spendable Notes**: Count of notes where `isNullifierSpent() === false`
   - **Total Notes**: Count of all decrypted notes

### Sync Strategies

**Option 1: On-Demand Sync**
- User requests sync via API endpoint
- Good for: Manual refresh, after transactions

**Option 2: Periodic Sync**
- Background job syncs nullifiers periodically
- Good for: Keeping database up-to-date automatically

**Option 3: Event-Driven Sync**
- Sync when transactions are processed
- Good for: Real-time updates

## Implementation Details

### Nullifier PDA Derivation

```typescript
const [pda] = PublicKey.findProgramAddressSync(
  [Buffer.from("nullifier"), nullifierBytes],
  programId
);
```

### On-Chain Account Decoding

The `NullifierRecord` account layout:
- Bytes 0-7: Anchor discriminator
- Byte 8: `used` (0 = false, 1 = true)
- Byte 9: `bump`

### Environment Variables

- `SOLANA_RPC_URL`: Solana RPC endpoint (default: `http://localhost:8899`)
- `SOLANA_PROGRAM_ID`: CipherPay Anchor program ID (default: `WRy4hstBsD6hxb7CJN4R3fgLnafs621N7EjUhZ2afze`)

## Future Enhancements

1. **Automatic Nullifier Extraction**: Extract nullifiers from transaction public inputs when transactions are recorded
2. **Note Decryption Service**: Service to decrypt `messages.ciphertext` and extract nullifiers
3. **Background Sync Job**: Periodic job to sync all nullifiers
4. **Webhook Integration**: Sync nullifiers when relayer processes transactions

