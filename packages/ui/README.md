# node 20
```bash
nvm use 20
```

# install
```bash
pnpm install
```

# SDK browser bundle (Vite loads `/sdk/cipherpay-sdk.browser.js`)

- `pnpm build:sdk` (repo root) only runs **TypeScript** for the SDK (`tsc`). It does **not** build the browser bundle or update `public/sdk/`.
- After SDK changes, either:
  - **`pnpm build:sdk:browser`** from repo root (builds browser bundle + copies to `public/sdk/`), or
  - **`pnpm build`** / **`pnpm --filter @cipherpay/ui build`** — UI **`prebuild`** runs `build:browser` and copies automatically.

# Build
```bash
pnpm run build
```

# Run
```bash
pnpm run dev
```

# Add some SOL to wallet
solana airdrop 20 FiFcdJauUsqSEUmxmNQm2z9fipC33xwvguVDZ43deMw3 --url http://127.0.0.1:8899
solana airdrop 20 3g5BNi1bzKFv6oS6vHxjeiGYzgMSZCR5bNd3SqipM39m --url http://127.0.0.1:8899
solana airdrop 20 8VMCHPzwug9rYYudXkLNYTtAGN96ht4mXaqrxHrTijRg --url http://127.0.0.1:8899
solana airdrop 20 3vaEV2uiK7uFQvcquukhAvQh5nYNrkL4miBJJ3C2Kqsi --url http://127.0.0.1:8899

# Check balance of a wallet
solana balance FiFcdJauUsqSEUmxmNQm2z9fipC33xwvguVDZ43deMw3 --url http://127.0.0.1:8899

# Check balance of ATA
node scripts/check-ata-balance.js FiFcdJauUsqSEUmxmNQm2z9fipC33xwvguVDZ43deMw3

# Check balance of PDA
---------------------------
# From cipherpay-ui directory
node scripts/check-vault-balance.js [rpc-url] [program-id] [token-mint]

# Examples:
# Default (localhost, default program, wSOL)
node scripts/check-vault-balance.js

# Custom RPC
node scripts/check-vault-balance.js http://127.0.0.1:8899

# Custom program and mint
node scripts/check-vault-balance.js http://127.0.0.1:8899 WRy4hstBsD6hxb7CJN4R3fgLnafs621N7EjUhZ2afze So11111111111111111111111111111111111111112
--------------------------

