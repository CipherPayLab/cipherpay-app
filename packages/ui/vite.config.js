import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { Buffer } from 'buffer';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
const eventemitter3Pkg = require.resolve('eventemitter3/package.json');
const eventemitter3Index = resolve(dirname(eventemitter3Pkg), 'index.js');

// Plugin to handle CommonJS modules that don't have default/named exports for ESM.
// We only append ESM exports to the same CJS value (module.exports); runtime behavior is unchanged.
const commonjsPlugin = () => ({
  name: 'commonjs-default-export',
  transform(code, id) {
    if (!code.includes('module.exports') || code.includes('export default')) return null;
    // eventemitter3 - only add default export (shim re-exports as EventEmitter); two export lines broke esbuild
    if (id.replace(/\\/g, '/').includes('eventemitter3/index.js')) {
      return { code: code + '\nexport default module.exports;', map: null };
    }
    // fast-deep-equal - used by @toruslabs/solana-embed as "dequal"
    if (id.includes('fast-deep-equal')) {
      return { code: code + '\nexport default module.exports;\nexport const dequal = module.exports;', map: null };
    }
    // sdp - CJS default export for webrtc-adapter
    if (id.replace(/\\/g, '/').includes('sdp/sdp.js')) {
      return { code: code + '\nexport default module.exports;', map: null };
    }
    // js-sha3 - CJS default for @ethersproject/keccak256
    if (id.replace(/\\/g, '/').includes('js-sha3')) {
      return { code: code + '\nexport default module.exports;', map: null };
    }
    // bech32 - CJS default for @ethersproject/providers
    if (id.replace(/\\/g, '/').includes('bech32/index.js')) {
      return { code: code + '\nexport default module.exports;', map: null };
    }
    return null;
  },
});

export default defineConfig({
  plugins: [
    react({
      // Process both .js and .jsx files as JSX
      // Also handle TypeScript files
      include: /\.(jsx|js|tsx|ts)$/,
      jsxRuntime: 'automatic',
      fastRefresh: true,
      // Use Babel to process JSX in .js files during import analysis
      // This ensures .js files with JSX are transformed before Vite tries to parse them
      babel: {
        parserOpts: {
          plugins: ['jsx']
        }
      }
    }),
    commonjsPlugin(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      buffer: 'buffer',
      assert: 'assert',
      events: 'events',
      util: 'util',
      stream: 'stream-browserify',
      // Shim so both default and named { EventEmitter } imports resolve (e.g. rpc-websockets)
      'eventemitter3': resolve(__dirname, './src/lib/eventemitter3-shim.js'),
      // Real package path for shim to import (avoids alias loop)
      'eventemitter3-real': eventemitter3Index,
    },
    extensions: ['.ts', '.tsx', '.jsx', '.js', '.json'],
    // Handle CommonJS modules better
    mainFields: ['browser', 'module', 'main'],
  },
  define: {
    'global': 'globalThis',
    // Deps (circomlibjs) read process.env.NODE_DEBUG; use global polyfill. Do NOT replace process.env with import.meta.env.
    'process': 'globalThis.process',
    'globalThis.Buffer': 'Buffer',
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        'process': 'globalThis.process',
      },
      loader: {
        '.js': 'jsx', // Critical: Tell esbuild to treat .js files as JSX
        '.jsx': 'jsx', // Ensure JSX files are handled
        '.ts': 'ts', // Ensure TypeScript files are handled
        '.tsx': 'tsx', // Ensure TSX files are handled
      },
      // Ensure JSX is parsed during dependency optimization
      jsx: 'automatic',
      // Handle CommonJS modules
      format: 'esm',
    },
    exclude: ['cipherpay-sdk'], // SDK is loaded via browser bundle
    include: ['buffer', 'assert', 'events', 'util', 'stream-browserify', 'circomlibjs', 'eventemitter3'],
  },
  ssr: {
    noExternal: [], // Don't externalize anything for SSR
    external: ['cipherpay-sdk'], // Mark SDK as external for SSR
  },
  // Vite automatically handles TypeScript via esbuild
  // TypeScript files (.ts, .tsx) are automatically transpiled
  build: {
    // Increase chunk size warning limit to 3000kb (3MB) 
    // circomlibjs is legitimately large (~2.5MB) and is loaded dynamically
    chunkSizeWarningLimit: 3000,
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
      // Handle CommonJS modules that don't have default exports
      defaultIsModuleExports: true,
      esmExternals: true,
    },
    rollupOptions: {
      output: {
        // Disable manualChunks to avoid "Cannot access 'X' before initialization" (TDZ)
        // errors from chunk load order. Rollup's default chunking preserves init order.
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/auth': {
        target: 'http://localhost:8788',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:8788',
        changeOrigin: true,
      },
      '/relayer': {
        target: 'http://localhost:8788',
        changeOrigin: true,
      },
      '/transactions': {
        target: 'http://localhost:8788',
        changeOrigin: true,
      },
      '/commitments': {
        target: 'http://localhost:8788',
        changeOrigin: true,
      },
      '/merkle': {
        target: 'http://localhost:8788',
        changeOrigin: true,
      },
    },
  },
  publicDir: 'public',
});
