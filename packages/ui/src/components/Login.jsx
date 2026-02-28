import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { useCipherPay } from '../contexts/CipherPayContext';
import WalletSelector from './WalletSelector';
import authService from '../services/authService';

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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-gray-900">Initializing CipherPay...</h2>
            <p className="mt-2 text-sm text-gray-600">Please wait while we set up your secure environment.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Welcome to CipherPay
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Privacy-preserving payments powered by zero-knowledge proofs
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Connection Error</h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>{error}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-8 space-y-6">
          {/* Toggle between Sign In / Sign Up */}
          <div className="flex rounded-md shadow-sm mb-6" role="group">
            <button
              type="button"
              onClick={() => setIsNewUser(false)}
              className={`flex-1 px-4 py-2 text-sm font-medium border ${
                !isNewUser
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              } rounded-l-lg focus:z-10 focus:ring-2 focus:ring-indigo-500`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setIsNewUser(true)}
              className={`flex-1 px-4 py-2 text-sm font-medium border-t border-b border-r ${
                isNewUser
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              } rounded-r-lg focus:z-10 focus:ring-2 focus:ring-indigo-500`}
            >
              Sign Up
            </button>
          </div>

          {/* Username input for new users */}
          {isNewUser && (
            <div className="space-y-2">
              <label htmlFor="username" className="block text-sm font-medium text-gray-700">
                Choose your username
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-500 sm:text-sm">@</span>
                </div>
                <input
                  type="text"
                  id="username"
                  value={username}
                  onChange={handleUsernameChange}
                  placeholder="alice"
                  className={`block w-full pl-7 pr-10 py-2 border ${
                    usernameError
                      ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                      : usernameAvailable
                      ? 'border-green-300 focus:ring-green-500 focus:border-green-500'
                      : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'
                  } rounded-md shadow-sm focus:outline-none sm:text-sm`}
                  required={isNewUser}
                  minLength={3}
                  maxLength={32}
                  pattern="[a-zA-Z0-9_-]+"
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  {checkingUsername && (
                    <svg className="animate-spin h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  )}
                  {!checkingUsername && usernameAvailable === true && (
                    <svg className="h-5 w-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  )}
                  {!checkingUsername && usernameAvailable === false && (
                    <svg className="h-5 w-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
              </div>
              {usernameError && (
                <p className="mt-1 text-sm text-red-600">{usernameError}</p>
              )}
              {usernameAvailable === true && (
                <p className="mt-1 text-sm text-green-600">✓ @{username} is available!</p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                3-32 characters, letters, numbers, underscore, or dash
              </p>
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
                  <div className="w-full border-t border-gray-300" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-gray-50 text-gray-500">Or continue with</span>
                </div>
              </div>

              {/* Sign In Form */}
              <form className="space-y-6" onSubmit={handleSignIn}>
                <div>
                  <p className="text-sm text-gray-600 text-center">
                    Sign in using your CipherPay identity. Your wallet is already connected.
                  </p>
                </div>
                <div>
                  <button
                    type="submit"
                    disabled={isConnecting || loading || !walletConnected}
                    className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isConnecting || loading ? 'Signing in...' : 'Sign in'}
                  </button>
                </div>
              </form>
            </>
          )}

          <div className="text-center">
            <a href="/register" className="font-medium text-indigo-600 hover:text-indigo-500">
              Don't have an account? Sign up
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login; 