import { build } from 'esbuild';
import { polyfillNode } from 'esbuild-plugin-polyfill-node';
import { readFileSync, writeFileSync } from 'fs';

// Banner with polyfills
const banner = readFileSync(new URL('../banner.js', import.meta.url), 'utf8');

async function buildBrowser() {
  try {
    const result = await build({
      entryPoints: ['src/index.ts'],
      bundle: true,
      platform: 'browser',
      target: 'es2020',
      format: 'iife',  // Use IIFE directly from esbuild
      globalName: '__SDK__',  // Temporary internal name
      minify: true,
      treeShaking: true,
      define: {
        'global': 'globalThis',
        'process.env.NODE_ENV': '"production"',
        'import.meta.url': '"https://cipherpay.sdk/index.js"',  // Replace import.meta.url
      },
      plugins: [
        polyfillNode({
          polyfills: {
            fs: 'empty',
            path: true,
            url: true,
            crypto: true,
          },
          globals: {
            Buffer: true,
            process: true,
          },
        }),
      ],
      outfile: 'dist/browser/index.temp.js',
      write: true,
    });

    // Read the generated file
    let code = readFileSync('dist/browser/index.temp.js', 'utf8');
    
    // The code is wrapped as: var __SDK__ = (function() { ... return exports; })();
    // __SDK__ is an object with exports like { CipherPaySDK: <class>, default: <class>, ... }
    // We need to extract the actual CipherPaySDK class and export it directly
    
    // Replace __SDK__ with __SDK_EXPORTS__ to avoid confusion
    code = code.replace(/\bvar __SDK__\b/g, 'var __SDK_EXPORTS__');
    code = code.replace(/\b__SDK__\b/g, '__SDK_EXPORTS__');
    
    // Extract and export both the CipherPaySDK class and utility functions
    code = code + `
// Extract the CipherPaySDK class and utilities from the exports and make them globally available
(function() {
  var SDKClass = __SDK_EXPORTS__.CipherPaySDK || __SDK_EXPORTS__.default;
  
  if (typeof SDKClass === 'function') {
    // Attach utility functions as properties of the constructor function
    // This allows both: new CipherPaySDK(config) AND CipherPaySDK.poseidonHash(...)
    SDKClass.TOKENS = __SDK_EXPORTS__.TOKENS;
    SDKClass.bigintifySignals = __SDK_EXPORTS__.bigintifySignals;
    SDKClass.commitmentOf = __SDK_EXPORTS__.commitmentOf;
    SDKClass.poseidonHash = __SDK_EXPORTS__.poseidonHash;
    SDKClass.poseidonHashForAuth = __SDK_EXPORTS__.poseidonHashForAuth;
    SDKClass.getAuthPubKeyFromPrivKey = __SDK_EXPORTS__.getAuthPubKeyFromPrivKey;
    SDKClass.signBabyJubPoseidon = __SDK_EXPORTS__.signBabyJubPoseidon;
    SDKClass.deposit = __SDK_EXPORTS__.deposit;
    SDKClass.transfer = __SDK_EXPORTS__.transfer;
    SDKClass.approveRelayerDelegate = __SDK_EXPORTS__.approveRelayerDelegate;
    SDKClass.revokeRelayerDelegate = __SDK_EXPORTS__.revokeRelayerDelegate;
    SDKClass.createIdentity = __SDK_EXPORTS__.createIdentity;
    SDKClass.deriveRecipientCipherPayPubKey = __SDK_EXPORTS__.deriveRecipientCipherPayPubKey;
    // Note encryption: The new secure approach uses Curve25519 public keys directly from DB
    // No derivation functions are exported - the public key is used directly for encryption
    
    // Circuit proof generation exports
    SDKClass.generateDepositProof = __SDK_EXPORTS__.generateDepositProof;
    SDKClass.generateTransferProof = __SDK_EXPORTS__.generateTransferProof;
    SDKClass.generateWithdrawProof = __SDK_EXPORTS__.generateWithdrawProof;
    SDKClass.generateAuditPaymentProof = __SDK_EXPORTS__.generateAuditPaymentProof;
    
    // Export to global
    if (typeof window !== 'undefined') {
      window.CipherPaySDK = SDKClass;
    }
    if (typeof globalThis !== 'undefined') {
      globalThis.CipherPaySDK = SDKClass;
    }
    console.log('[SDK Bundle] CipherPaySDK class exported with utilities as properties');
    console.log('[SDK Bundle] Available: new CipherPaySDK(config), CipherPaySDK.poseidonHash(), CipherPaySDK.createIdentity(), etc.');
  } else {
    console.error('[SDK Bundle] Failed to find CipherPaySDK class in exports:', Object.keys(__SDK_EXPORTS__));
  }
})();
`;
    
    // Prepend our banner with polyfills
    const wrapped = `${banner}\n${code}`;

    // Write the final bundle
    writeFileSync('dist/browser/cipherpay-sdk.browser.js', wrapped);
    
    // Clean up temp file
    try {
      const { unlinkSync } = await import('fs');
      unlinkSync('dist/browser/index.temp.js');
    } catch (e) {
      // Ignore if file doesn't exist
    }
    
    console.log('✅ Browser bundle created successfully! (6.1 MB)');
    
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

buildBrowser();

