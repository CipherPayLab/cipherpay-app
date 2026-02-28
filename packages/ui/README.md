# node 20
```bash
nvm use 20
```

# install
```bash
npm install
```

# Build
```bash
npm run build
```

# Run
```bash
npm run dev
```

# Add some SOL to wallet
solana airdrop 20 FiFcdJauUsqSEUmxmNQm2z9fipC33xwvguVDZ43deMw3 --url http://127.0.0.1:8899
solana airdrop 20 3g5BNi1bzKFv6oS6vHxjeiGYzgMSZCR5bNd3SqipM39m --url http://127.0.0.1:8899
solana airdrop 20 8VMCHPzwug9rYYudXkLNYTtAGN96ht4mXaqrxHrTijRg --url http://127.0.0.1:8899

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
node scripts/check-vault-balance.js http://127.0.0.1:8899 24gZSJMyGiAbaTcBEm9WZyfq9TvkJJDQWake7uNHvPKj So11111111111111111111111111111111111111112
--------------------------

