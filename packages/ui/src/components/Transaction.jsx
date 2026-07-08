import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Info } from 'lucide-react';
import { useCipherPay } from '../contexts/CipherPayContext';
import MessageModal from './MessageModal';

function Transaction() {
  const navigate = useNavigate();
  const {
    isConnected,
    balance,
    spendableNotes,
    createTransfer,
    sendTransfer,
    loading,
    error,
    clearError
  } = useCipherPay();

  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [transactionStep, setTransactionStep] = useState('form'); // form, creating, sending, success
  const [transactionHash, setTransactionHash] = useState('');
  const [selectedNotes, setSelectedNotes] = useState([]);
  const [infoModal, setInfoModal] = useState(null); // { title, message }
  const showInfoModal = (title, message) => setInfoModal({ title, message });

  useEffect(() => {
    if (!isConnected) {
      navigate('/');
    }
  }, [isConnected, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!isConnected) {
      showInfoModal('Wallet required', 'Please connect your wallet first.');
      return;
    }

    if (Number(amount) <= 0) {
      showInfoModal('Invalid amount', 'Please enter a valid amount.');
      return;
    }

    if (!recipient || recipient.length < 42) {
      showInfoModal('Invalid recipient', 'Please enter a valid recipient address.');
      return;
    }

    if (Number(amount) > Number(balance) / 1e18) {
      showInfoModal('Insufficient balance', "You don't have enough balance for this transaction.");
      return;
    }

    try {
      clearError();
      setTransactionStep('creating');

      // Create the transfer
      const transaction = await createTransfer(recipient, amount);

      setTransactionStep('sending');

      // Send the transfer
      const receipt = await sendTransfer(transaction);
      setTransactionHash(receipt.txHash);
      setTransactionStep('success');

      // Reset form after successful transaction
      setTimeout(() => {
        setAmount('');
        setRecipient('');
        setTransactionStep('form');
        setTransactionHash('');
        navigate('/dashboard');
      }, 3000);

    } catch (err) {
      console.error('Transaction failed:', err);
      setTransactionStep('form');
    }
  };

  const formatBalance = (balance) => {
    return Number(balance) / 1e18;
  };

  const handleNoteSelection = (note) => {
    setSelectedNotes(prev => {
      const isSelected = prev.find(n => n.commitment === note.commitment);
      if (isSelected) {
        return prev.filter(n => n.commitment !== note.commitment);
      } else {
        return [...prev, note];
      }
    });
  };

  const getSelectedAmount = () => {
    return selectedNotes.reduce((total, note) => total + Number(note.amount), 0) / 1e18;
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">Please connect your wallet first</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Create Transaction</h1>
              <p className="mt-2 text-gray-600">
                Send privacy-preserving payments using zero-knowledge proofs
              </p>
            </div>
            <button
              onClick={() => navigate('/dashboard')}
              className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium"
            >
              Back to Dashboard
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Transaction Error</h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>{error}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Balance Information */}
        <div className="bg-white overflow-hidden shadow rounded-lg mb-6">
          <div className="px-4 py-5 sm:p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Account Balance</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <dt className="text-sm font-medium text-gray-500">Available Balance</dt>
                <dd className="mt-1 text-2xl font-semibold text-gray-900">
                  {formatBalance(balance)} ETH
                </dd>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg">
                <dt className="text-sm font-medium text-gray-500">Spendable Notes</dt>
                <dd className="mt-1 text-2xl font-semibold text-gray-900">
                  {spendableNotes.length}
                </dd>
              </div>
            </div>
          </div>
        </div>

        {/* Transaction Form */}
        {transactionStep === 'form' && (
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Transaction Details</h2>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label htmlFor="recipient" className="block text-sm font-medium text-gray-700">
                    Recipient Address
                  </label>
                  <input
                    type="text"
                    id="recipient"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    required
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    placeholder="0x..."
                  />
                </div>

                <div>
                  <label htmlFor="amount" className="block text-sm font-medium text-gray-700">
                    Amount (ETH)
                  </label>
                  <input
                    type="number"
                    id="amount"
                    step="0.000001"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    placeholder="0.0"
                  />
                </div>

                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => navigate('/dashboard')}
                    className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
                  >
                    {loading ? 'Processing...' : 'Create Transaction'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Transaction Progress */}
        {transactionStep === 'creating' && (
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
              <h3 className="text-lg font-medium text-gray-900">Creating Transaction</h3>
              <p className="text-gray-600">Generating zero-knowledge proof...</p>
            </div>
          </div>
        )}

        {transactionStep === 'sending' && (
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
              <h3 className="text-lg font-medium text-gray-900">Sending Transaction</h3>
              <p className="text-gray-600">Submitting to relayer...</p>
            </div>
          </div>
        )}

        {/* Success Message */}
        {transactionStep === 'success' && (
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6 text-center">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 mb-4">
                <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900">Transaction Successful!</h3>
              <p className="text-gray-600 mb-4">Your privacy-preserving transaction has been submitted.</p>
              {transactionHash && (
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Transaction Hash:</p>
                  <p className="text-sm font-mono text-gray-900 break-all">{transactionHash}</p>
                </div>
              )}
              <p className="text-sm text-gray-500 mt-4">Redirecting to dashboard...</p>
            </div>
          </div>
        )}

        {/* Note Selection (Optional Enhancement) */}
        {spendableNotes.length > 0 && transactionStep === 'form' && (
          <div className="bg-white overflow-hidden shadow rounded-lg mt-6">
            <div className="px-4 py-5 sm:p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Select Input Notes (Optional)</h2>
              <p className="text-sm text-gray-600 mb-4">
                You can manually select which notes to spend, or let the system choose automatically.
              </p>
              <div className="space-y-2">
                {spendableNotes.map((note, index) => (
                  <label key={index} className="flex items-center p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={selectedNotes.find(n => n.commitment === note.commitment) !== undefined}
                      onChange={() => handleNoteSelection(note)}
                      className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                    />
                    <div className="ml-3">
                      <p className="text-sm font-medium text-gray-900">
                        Note {note.commitment?.slice(0, 8)}...
                      </p>
                      <p className="text-sm text-gray-500">
                        Amount: {Number(note.amount) / 1e18} ETH
                      </p>
                    </div>
                  </label>
                ))}
              </div>
              {selectedNotes.length > 0 && (
                <div className="mt-4 p-3 bg-indigo-50 rounded-lg">
                  <p className="text-sm text-indigo-700">
                    Selected amount: {getSelectedAmount()} ETH
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <MessageModal
        open={!!infoModal}
        onClose={() => setInfoModal(null)}
        icon={Info}
        title={infoModal?.title}
        description={infoModal?.message}
        primaryLabel="OK"
        onPrimary={() => setInfoModal(null)}
      />
    </div>
  );
}

export default Transaction; 