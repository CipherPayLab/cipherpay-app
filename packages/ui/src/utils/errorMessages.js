/**
 * Extract a user-friendly error message from nested JSON and technical error strings.
 * Handles relayer/Solana RPC errors that come as deeply nested escaped JSON.
 */

/**
 * Recursively extract the innermost human-readable message from nested JSON.
 * @param {string} msg - Raw error message (may contain JSON)
 * @returns {string} User-friendly message
 */
export function parseFriendlyErrorMessage(msg) {
  if (!msg || typeof msg !== 'string') return 'An unexpected error occurred.';

  // Early check for known patterns (works even when nested in escaped JSON)
  if (msg.includes('airdrop limit') || msg.includes('faucet has run dry') || msg.includes('faucet.solana.com')) {
    return "The Solana devnet faucet limit has been reached. Please visit https://faucet.solana.com for alternate sources of test SOL, or try again later.";
  }
  if (msg.includes('429') && msg.toLowerCase().includes('too many')) {
    return 'Rate limit exceeded. Please wait a moment and try again.';
  }
  if (msg.includes('commitment not found')) {
    return 'The selected note could not be found. It may have already been spent. Please refresh your notes and try again.';
  }

  // Strip HTML
  if (msg.includes('<!') || msg.includes('<html') || msg.includes('<body') || msg.includes('<pre>')) {
    if (msg.includes('Internal Server Error') || msg.includes('500')) {
      return 'The operation failed. Please try again.';
    }
    return 'The operation failed. Please refresh and try again.';
  }

  let current = msg;
  let depth = 0;
  const maxDepth = 6;

  // Try to find JSON in the string (e.g. "Server submit failed: 500 {...}")
  const jsonStart = current.indexOf('{');
  if (jsonStart >= 0) {
    current = current.slice(jsonStart);
  }

  // Recursively extract "message" from JSON
  while (depth < maxDepth) {
    const trimmed = current.trim();
    if (!trimmed.startsWith('{')) break;

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.message === 'string') {
        current = parsed.message.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        depth++;
        continue;
      }
    } catch {
      // Not valid JSON, try to extract message from common patterns (handles escaped quotes)
      const jsonMatch = trimmed.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (jsonMatch) {
        current = jsonMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n');
        depth++;
        continue;
      }
      break;
    }
    break;
  }

  // Clean up common RPC/faucet prefixes
  let result = current
    .replace(/^\d+\s+[A-Za-z\s]+:\s*\{\s*"jsonrpc"[^}]*\}\s*\r?\n?/g, '')
    .replace(/\r\n/g, ' ')
    .replace(/\n/g, ' ')
    .trim();

  // Try to extract message from nested JSON in the result (e.g. Solana RPC error)
  const rpcMessageMatch = result.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (rpcMessageMatch) {
    const inner = rpcMessageMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    if (inner.length > 10 && inner.length < 500) result = inner;
  }

  // Known friendly mappings for common errors (check both result and original msg)
  const fullText = result + ' ' + msg;
  if (fullText.includes("airdrop limit") || fullText.includes("faucet has run dry") || fullText.includes("faucet.solana.com")) {
    return "The Solana devnet faucet limit has been reached. Please visit https://faucet.solana.com for alternate sources of test SOL, or try again later.";
  }
  if (result.includes('429') && result.toLowerCase().includes('too many')) {
    return 'Rate limit exceeded. Please wait a moment and try again.';
  }
  if (result.includes('commitment not found')) {
    return 'The selected note could not be found. It may have already been spent. Please refresh your notes and try again.';
  }
  if (result.includes('insufficient') || result.includes('not enough') || result.toLowerCase().includes('balance')) {
    return result.length > 200 ? 'Insufficient balance. Please check your wallet and try again.' : result;
  }
  if (result.includes('User rejected') || result.includes('rejected')) {
    return 'Transaction was rejected. Please try again.';
  }

  // If result is still very long or looks like raw JSON, use a generic message
  if (result.length > 300 || (result.includes('{') && result.includes('"jsonrpc"')) || result.includes('RelayerError') || result.includes('SolanaTransactionError')) {
    return 'The deposit could not be completed. Please try again or check your connection.';
  }

  // Fallback for "Server submit deposit failed" style errors that slipped through
  if (msg.includes('Server submit deposit failed') || msg.includes('Server prepare deposit failed')) {
    return 'The deposit could not be completed. Please try again.';
  }

  return result || 'An unexpected error occurred.';
}
