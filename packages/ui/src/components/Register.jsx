import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Info, AlertTriangle } from 'lucide-react';
import { useCipherPay } from '../contexts/CipherPayContext';
import WalletSelector from './WalletSelector';
import MessageModal from './MessageModal';

const INFO_MODAL_ICONS = { info: Info, error: AlertTriangle };

function Register() {
  const navigate = useNavigate();
  const {
    isInitialized,
    isConnected,
    isAuthenticated,
    connectWallet,
    signUp,
    loading,
    error,
    clearError
  } = useCipherPay();

  const [registrationStep, setRegistrationStep] = useState('form'); // form, wallet-selection, authenticating, success
  const [isConnecting, setIsConnecting] = useState(false);
  const [infoModal, setInfoModal] = useState(null); // { title, message, tone }
  const showInfoModal = (title, message, tone = 'info') => setInfoModal({ title, message, tone });

  useEffect(() => {
    if (isAuthenticated) {
      setRegistrationStep('success');
      // Redirect to dashboard after 2 seconds
      setTimeout(() => {
        navigate('/dashboard');
      }, 2000);
    }
  }, [isAuthenticated, navigate]);

  const handleSignUp = (e) => {
    e.preventDefault();
    if (!isInitialized) {
      showInfoModal('Still initializing', 'CipherPay service is still initializing. Please wait...');
      return;
    }
    // Show wallet selection UI
    setRegistrationStep('wallet-selection');
    clearError();
  };

  const handleWalletConnect = () => {
    if (!isInitialized) {
      showInfoModal('Still initializing', 'CipherPay service is still initializing. Please wait...');
      return;
    }
    // Show wallet selection UI
    setRegistrationStep('wallet-selection');
    clearError();
  };

  // Handle wallet connection from WalletSelector
  const handleWalletConnected = async (walletAddress) => {
    if (!isInitialized) {
      showInfoModal('Still initializing', 'CipherPay service is still initializing. Please wait...');
      return;
    }

    try {
      setIsConnecting(true);
      setRegistrationStep('authenticating');
      clearError();
      
      console.log('[Register] handleWalletConnected: walletAddress parameter:', walletAddress);
      
      // Connect wallet to CipherPay service using the selected wallet address
      if (!isConnected) {
        await connectWallet();
      }
      
      // Sign up (creates identity and authenticates)
      // Pass the wallet address directly to ensure it's used
      await signUp(walletAddress);
      // After successful signup, redirect to dashboard
      // The useEffect will handle this via isAuthenticated
    } catch (err) {
      console.error('Failed to connect wallet and sign up:', err);
      showInfoModal('Registration failed', err.message || 'Unknown error', 'error');
      setRegistrationStep('wallet-selection');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleWalletDisconnected = () => {
    // Wallet disconnected - clear any errors
    clearError();
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
            Create Your CipherPay Account
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Join the privacy-preserving payment revolution
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Registration Error</h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>{error}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Registration Form */}
        {registrationStep === 'form' && (
          <div className="mt-8 space-y-6">
            <form className="space-y-6" onSubmit={handleSignUp}>
              <div>
                <p className="text-sm text-gray-600 text-center">
                  Create your CipherPay account. Your identity will be generated automatically.
                </p>
              </div>
              <div>
                <button
                  type="submit"
                  disabled={loading}
                  className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Creating account...' : 'Create Account'}
                </button>
              </div>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-gray-50 text-gray-500">Or start with</span>
              </div>
            </div>

            {/* Wallet Registration */}
            <div>
              <button
                onClick={handleWalletConnect}
                disabled={loading}
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                {loading ? 'Connecting...' : 'Connect Wallet & Start'}
              </button>
            </div>

            <div className="text-center">
              <a href="/" className="font-medium text-indigo-600 hover:text-indigo-500">
                Already have an account? Sign in
              </a>
            </div>
          </div>
        )}

        {/* Wallet Selection Step */}
        {registrationStep === 'wallet-selection' && (
          <div className="mt-8 space-y-6">
            <div>
              <p className="text-sm text-gray-600 text-center mb-4">
                Select a wallet to create your CipherPay account
              </p>
            </div>
            <WalletSelector
              onWalletConnected={handleWalletConnected}
              onWalletDisconnected={handleWalletDisconnected}
            />
            <div className="text-center">
              <button
                onClick={() => setRegistrationStep('form')}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                ← Back
              </button>
            </div>
          </div>
        )}

        {/* Authenticating Step */}
        {registrationStep === 'authenticating' && (
          <div className="mt-8 space-y-6">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
              <h3 className="text-lg font-medium text-gray-900">Creating Your Account</h3>
              <p className="text-gray-600">Please wait while we set up your CipherPay identity...</p>
            </div>
          </div>
        )}

        {/* Success Message */}
        {registrationStep === 'success' && (
          <div className="mt-8 space-y-6">
            <div className="text-center">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 mb-4">
                <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900">Registration Successful!</h3>
              <p className="text-gray-600 mb-4">Your CipherPay account has been created successfully.</p>
              <p className="text-sm text-gray-500 mt-4">Redirecting to dashboard...</p>
            </div>
          </div>
        )}
      </div>

      <MessageModal
        open={!!infoModal}
        onClose={() => setInfoModal(null)}
        tone={infoModal?.tone || 'info'}
        icon={INFO_MODAL_ICONS[infoModal?.tone || 'info']}
        title={infoModal?.title}
        description={infoModal?.message}
        primaryLabel="OK"
        onPrimary={() => setInfoModal(null)}
      />
    </div>
  );
}

export default Register;