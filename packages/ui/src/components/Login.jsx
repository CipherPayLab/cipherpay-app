import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { Mail, ShieldCheck, Zap, Wallet, Check, X, Loader2 } from 'lucide-react';
import { FaXTwitter, FaDiscord, FaGithub } from 'react-icons/fa6';
import { useCipherPay } from '../contexts/CipherPayContext';
import WalletSelector from './WalletSelector';
import authService from '../services/authService';

const NAV_LINKS = ['Features', 'Security', 'Docs', 'About'];
const FOOTER_LINKS = ['Privacy', 'Terms', 'Docs', 'Status', 'Support'];
const FEATURES = [
  {
    icon: ShieldCheck,
    title: 'Zero-knowledge privacy',
    description: 'Your data stays private, while proof ensures trust.',
  },
  {
    icon: Zap,
    title: 'Fast, secure settlement',
    description: 'Built for speed with cryptographic guarantees.',
  },
  {
    icon: Wallet,
    title: 'Wallet-native experience',
    description: 'Connect your wallet and start in seconds.',
  },
];

function Login() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [isNewUser, setIsNewUser] = useState(false); // Default to Sign In (returning users)
  const navigate = useNavigate();
  const hasNavigated = useRef(false);
  const sessionAuthenticatedRef = useRef(false); // Track if authenticated in THIS session
  const usernameCheckTimeout = useRef(null);
  const { publicKey, connected: walletConnected, disconnect: disconnectWallet } = useWallet();

  const {
    isInitialized,
    isConnected,
    isAuthenticated,
    connectWallet,
    signIn,
    signUp,
    loading,
    error,
    clearError
  } = useCipherPay();

  // Redirect to dashboard ONLY if user completed authentication flow on login page
  // Don't redirect if user just navigated back to login with a stored token
  useEffect(() => {
    // Only check for redirect if we're on the login page
    const currentPath = window.location.pathname;
    if (currentPath !== '/') {
      return;
    }

    // Don't redirect during initialization
    if (!isInitialized || loading) {
      return;
    }

    // ONLY redirect if:
    // 1. User authenticated in this session (via handleWalletConnected or handleSignIn)
    // 2. AND user is connected
    // 3. AND we haven't already navigated
    if (sessionAuthenticatedRef.current && isAuthenticated && isConnected && !hasNavigated.current) {
      hasNavigated.current = true;
      setTimeout(() => {
        navigate('/dashboard', { replace: true });
      }, 0);
    }

    // Reset flags if user disconnects
    if (!isAuthenticated || !isConnected) {
      hasNavigated.current = false;
      sessionAuthenticatedRef.current = false;
    }
  }, [isInitialized, isAuthenticated, isConnected, loading, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Check username availability (debounced)
  const checkUsernameAvailability = async (value) => {
    if (!value || value.length < 3) {
      setUsernameAvailable(null);
      return;
    }

    setCheckingUsername(true);
    try {
      const result = await authService.checkUsernameAvailability(value);

      if (!result.valid) {
        setUsernameError(result.error || 'Invalid username format');
        setUsernameAvailable(false);
      } else if (!result.available) {
        setUsernameError(`@${value} is taken. Try: ${result.suggestions?.join(', ') || ''}`);
        setUsernameAvailable(false);
      } else {
        setUsernameError('');
        setUsernameAvailable(true);
      }
    } catch (error) {
      console.error('Username check failed:', error);
      setUsernameError('Failed to check username');
      setUsernameAvailable(null);
    } finally {
      setCheckingUsername(false);
    }
  };

  // Handle username input change
  const handleUsernameChange = (e) => {
    const value = e.target.value.toLowerCase().trim();
    setUsername(value);
    setUsernameError('');
    setUsernameAvailable(null);

    // Clear previous timeout
    if (usernameCheckTimeout.current) {
      clearTimeout(usernameCheckTimeout.current);
    }

    // Debounce username check (500ms)
    if (value && value.length >= 3) {
      usernameCheckTimeout.current = setTimeout(() => {
        checkUsernameAvailability(value);
      }, 500);
    } else if (value && value.length > 0 && value.length < 3) {
      setUsernameError('Username must be at least 3 characters');
    }
  };

  // Handle wallet connection from WalletSelector
  const handleWalletConnected = async (walletAddress) => {
    if (!isInitialized) {
      alert('CipherPay service is still initializing. Please wait...');
      return;
    }

    // Check if user just disconnected - don't auto-authenticate in this case
    // This prevents redirect loop when user disconnects and lands on login page
    try {
      const justDisconnected = sessionStorage.getItem('cipherpay_just_disconnected');
      if (justDisconnected === '1') {
        console.log('[Login] User just disconnected, skipping auto-authentication');
        sessionStorage.removeItem('cipherpay_just_disconnected');
        // Don't auto-authenticate - let user manually click "Connect" button
        return;
      }
    } catch (e) {
      // Ignore sessionStorage errors
    }

    // For new users, require username
    if (isNewUser) {
      if (!username || username.length < 3) {
        alert('Please enter a username (at least 3 characters)');
        // Disconnect wallet so user stays on sign-up screen
        await disconnectWallet();
        return;
      }
      if (usernameAvailable === false) {
        alert('This username is not available. Please choose another one.');
        // Disconnect wallet so user stays on sign-up screen
        await disconnectWallet();
        return;
      }
      if (!usernameAvailable) {
        // Still checking or not checked yet
        alert('Please wait while we check username availability...');
        // Disconnect wallet so user stays on sign-up screen
        await disconnectWallet();
        return;
      }
    }

    try {
      setIsConnecting(true);
      clearError();

      console.log('[Login] handleWalletConnected: walletAddress parameter:', walletAddress);
      console.log('[Login] handleWalletConnected: username:', username || '(existing user)');

      // Connect wallet to CipherPay service using the selected wallet address
      if (!isConnected) {
        await connectWallet();
      }

      // Authenticate - pass username for new users
      if (isNewUser && username) {
        console.log('[Login] Signing up new user with username:', username);
        await signUp(walletAddress, username);
      } else {
        console.log('[Login] Signing in existing user');
        await signIn(walletAddress);
      }

      // Mark that user authenticated in this session
      sessionAuthenticatedRef.current = true;

      navigate('/dashboard');
    } catch (err) {
      console.error('Failed to connect and authenticate:', err);

      // Check if user doesn't exist (trying to sign in without account)
      const errorData = err.response?.data;
      if (errorData?.error === 'missing_username' ||
          errorData?.message?.includes('Username is required for new users')) {
        // User tried to sign in but doesn't have an account
        alert('You have to sign up firstly');
        setIsNewUser(true); // Switch to Sign Up tab
        await disconnectWallet(); // Disconnect so they can reconnect with username
        return;
      }

      // Check if error is due to missing username
      if (err.message?.includes('username') || err.message?.includes('Username')) {
        alert(`Username required: ${err.message}. Please enter a username and try again.`);
      } else {
        alert(`Authentication failed: ${err.message || 'Unknown error'}`);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleWalletDisconnected = () => {
    // Wallet disconnected - clear any errors
    clearError();
  };

  const handleSignIn = async (e) => {
    e.preventDefault();
    if (!isInitialized) {
      alert('CipherPay service is still initializing. Please wait...');
      return;
    }

    // Check if wallet is connected
    if (!walletConnected || !publicKey) {
      alert('Please connect a wallet first');
      return;
    }

    try {
      setIsConnecting(true);
      clearError();

      // Get wallet address from the connected wallet
      const walletAddr = publicKey.toBase58();
      console.log('[Login] handleSignIn: Using wallet address:', walletAddr);

      // Connect wallet to CipherPay service if not already connected
      if (!isConnected) {
        await connectWallet();
      }

      // Authenticate with server, passing the wallet address directly
      // For new users signing up through the form (not auto-connect), pass username
      if (isNewUser && username) {
        await signUp(walletAddr, username);
      } else {
        await signIn(walletAddr);
      }

      // Mark that user authenticated in this session
      sessionAuthenticatedRef.current = true;

      navigate('/dashboard');
    } catch (err) {
      console.error('Sign in failed:', err);
      alert(`Sign in failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsConnecting(false);
    }
  };

  if (loading && !isInitialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#05070f]">
        <div className="w-full max-w-md space-y-8 text-center">
          <h2 className="text-3xl font-bold text-white">Initializing CipherPay...</h2>
          <p className="mt-2 text-sm text-gray-400">Please wait while we set up your secure environment.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-[#05070f] bg-cover bg-center bg-no-repeat text-white"
      style={{ backgroundImage: "url('/images/cipherpay-hero-bg.png')" }}
    >
      <div className="min-h-screen bg-[#05070f]/60">
        {/* Header */}
        <header className="border-b border-white/10">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <img src="/images/Header-Footer-logo.png" alt="CipherPay" className="h-8 w-auto" />
            <nav className="hidden items-center gap-8 md:flex">
              {NAV_LINKS.map((link) => (
                <a key={link} href="#" className="text-sm text-gray-300 transition-colors hover:text-white">
                  {link}
                </a>
              ))}
            </nav>
            <div className="flex items-center gap-3">
              <a
                href="#"
                className="flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm text-gray-200 transition-colors hover:border-white/30"
              >
                <Mail className="h-4 w-4" />
                Contact
              </a>
              <a
                href="#"
                className="flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm text-gray-200 transition-colors hover:border-white/30"
              >
                <span className="h-2 w-2 rounded-full bg-green-400" />
                Status
              </a>
            </div>
          </div>
        </header>

        {/* Hero + Auth */}
        <main className="mx-auto grid max-w-7xl gap-16 px-6 py-16 lg:grid-cols-2 lg:items-center">
          {/* Left: marketing copy */}
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 px-4 py-1.5 text-sm text-blue-300">
              <ShieldCheck className="h-4 w-4" />
              Privacy by design. Trust by proof.
            </div>

            <h1 className="mt-6 text-5xl font-extrabold leading-tight tracking-tight">
              Private Payments,
              <br />
              <span className="bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                Verifiable Trust
              </span>
            </h1>

            <p className="mt-6 max-w-md text-gray-400">
              CipherPay enables privacy-preserving payments powered by zero-knowledge proofs.
            </p>

            <div className="mt-10 space-y-6">
              {FEATURES.map(({ icon: Icon, title, description }) => (
                <div key={title} className="flex items-start gap-4">
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                    <Icon className="h-5 w-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="font-medium text-white">{title}</p>
                    <p className="text-sm text-gray-400">{description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: auth card */}
          <div className="rounded-2xl border border-white/10 bg-[#0d1220]/90 shadow-2xl backdrop-blur">
            <div className="flex border-b border-white/10">
              <button
                type="button"
                onClick={() => setIsNewUser(false)}
                className={`flex-1 border-b-2 py-4 text-sm font-medium transition-colors ${
                  !isNewUser ? 'border-blue-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setIsNewUser(true)}
                className={`flex-1 border-b-2 py-4 text-sm font-medium transition-colors ${
                  isNewUser ? 'border-blue-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                Sign Up
              </button>
            </div>

            <div className="space-y-6 p-8">
              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
                  <h3 className="text-sm font-medium text-red-300">Connection Error</h3>
                  <p className="mt-1 text-sm text-red-400">{error}</p>
                </div>
              )}

              {/* Wallet-first access blurb */}
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                  <Wallet className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <p className="font-medium text-white">Wallet-first access</p>
                  <p className="text-sm text-gray-400">Connect your wallet to securely sign in.</p>
                </div>
              </div>

              {/* Username input for new users */}
              {isNewUser && (
                <div className="space-y-2">
                  <label htmlFor="username" className="block text-sm font-medium text-gray-300">
                    Choose your username
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <span className="text-gray-500 sm:text-sm">@</span>
                    </div>
                    <input
                      type="text"
                      id="username"
                      value={username}
                      onChange={handleUsernameChange}
                      placeholder="alice"
                      className={`block w-full rounded-lg border bg-white/5 py-2 pl-7 pr-10 text-white placeholder-gray-600 focus:outline-none focus:ring-2 sm:text-sm ${
                        usernameError
                          ? 'border-red-500/40 focus:border-red-500 focus:ring-red-500/30'
                          : usernameAvailable
                          ? 'border-green-500/40 focus:border-green-500 focus:ring-green-500/30'
                          : 'border-white/10 focus:border-blue-500 focus:ring-blue-500/30'
                      }`}
                      required={isNewUser}
                      minLength={3}
                      maxLength={32}
                      pattern="[a-zA-Z0-9_-]+"
                    />
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                      {checkingUsername && <Loader2 className="h-5 w-5 animate-spin text-gray-500" />}
                      {!checkingUsername && usernameAvailable === true && (
                        <Check className="h-5 w-5 text-green-400" />
                      )}
                      {!checkingUsername && usernameAvailable === false && (
                        <X className="h-5 w-5 text-red-400" />
                      )}
                    </div>
                  </div>
                  {usernameError && <p className="text-sm text-red-400">{usernameError}</p>}
                  {usernameAvailable === true && (
                    <p className="text-sm text-green-400">✓ @{username} is available!</p>
                  )}
                  <p className="text-xs text-gray-500">3-32 characters, letters, numbers, underscore, or dash</p>
                </div>
              )}

              {/* Wallet Selection */}
              <WalletSelector
                onWalletConnected={handleWalletConnected}
                onWalletDisconnected={handleWalletDisconnected}
              />

              {walletConnected && publicKey && (
                <>
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-white/10" />
                    </div>
                    <div className="relative flex justify-center text-sm">
                      <span className="bg-[#0d1220] px-2 text-gray-500">Or continue with</span>
                    </div>
                  </div>

                  <form className="space-y-4" onSubmit={handleSignIn}>
                    <p className="text-center text-sm text-gray-400">
                      Sign in using your CipherPay identity. Your wallet is already connected.
                    </p>
                    <button
                      type="submit"
                      disabled={isConnecting || loading || !walletConnected}
                      className="flex w-full items-center justify-center rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isConnecting || loading ? 'Signing in...' : 'Sign in'}
                    </button>
                  </form>
                </>
              )}

              <div className="border-t border-white/10 pt-6 text-center text-sm text-gray-400">
                {isNewUser ? (
                  <>
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => setIsNewUser(false)}
                      className="font-medium text-blue-400 hover:text-blue-300"
                    >
                      Sign in
                    </button>
                  </>
                ) : (
                  <>
                    Don't have an account?{' '}
                    <button
                      type="button"
                      onClick={() => setIsNewUser(true)}
                      className="font-medium text-blue-400 hover:text-blue-300"
                    >
                      Sign up
                    </button>
                  </>
                )}
                <p className="mt-2 text-xs text-gray-500">
                  By continuing, you agree to our <a href="#" className="text-gray-400 hover:text-gray-300">Terms</a> and{' '}
                  <a href="#" className="text-gray-400 hover:text-gray-300">Privacy Policy</a>.
                </p>
              </div>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-white/10">
          <div className="mx-auto flex max-w-7xl flex-col items-center gap-6 px-6 py-8 md:flex-row md:justify-between">
            <img src="/images/Header-Footer-logo.png" alt="CipherPay" className="h-7 w-auto" />
            <nav className="flex flex-wrap items-center justify-center gap-6">
              {FOOTER_LINKS.map((link) => (
                <a key={link} href="#" className="text-sm text-gray-400 hover:text-gray-200">
                  {link}
                </a>
              ))}
            </nav>
            <div className="flex items-center gap-4 text-gray-400">
              <a href="#" aria-label="Twitter" className="hover:text-white">
                <FaXTwitter className="h-5 w-5" />
              </a>
              <a href="#" aria-label="Discord" className="hover:text-white">
                <FaDiscord className="h-5 w-5" />
              </a>
              <a href="#" aria-label="GitHub" className="hover:text-white">
                <FaGithub className="h-5 w-5" />
              </a>
            </div>
          </div>
          <p className="pb-8 text-center text-xs text-gray-500">
            © {new Date().getFullYear()} CipherPay. All rights reserved.
          </p>
        </footer>
      </div>
    </div>
  );
}

export default Login;
