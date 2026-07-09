import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Info } from 'lucide-react';
import { useCipherPay } from '../contexts/CipherPayContext';
import MessageModal from './MessageModal';

function Proof() {
  const navigate = useNavigate();
  const {
    isConnected,
    allNotes,
    generateProof,
    verifyProof,
    generateProofOfPayment,
    verifyProofOfPayment,
    exportViewKey,
    loading,
    error,
    clearError
  } = useCipherPay();

  const [proofType, setProofType] = useState('transfer'); // transfer, payment
  const [selectedNote, setSelectedNote] = useState('');
  const [proofInput, setProofInput] = useState('');
  const [generatedProof, setGeneratedProof] = useState(null);
  const [verificationResult, setVerificationResult] = useState(null);
  const [viewKey, setViewKey] = useState('');
  const [proofStep, setProofStep] = useState('form'); // form, generating, success
  const [infoModal, setInfoModal] = useState(null); // { title, message }
  const showInfoModal = (title, message) => setInfoModal({ title, message });

  useEffect(() => {
    if (!isConnected) {
      navigate('/');
    }
  }, [isConnected, navigate]);

  const handleGenerateProof = async (e) => {
    e.preventDefault();

    if (!isConnected) {
      showInfoModal('Wallet required', 'Please connect your wallet first.');
      return;
    }

    try {
      clearError();
      setProofStep('generating');
      setGeneratedProof(null);
      setVerificationResult(null);

      let proof;
      if (proofType === 'transfer') {
        // Generate transfer proof
        const input = {
          // This would be the actual input structure for the transfer circuit
          // For now, using a placeholder
          amount: proofInput,
          recipient: '0x...',
          nullifier: '0x...',
          commitment: '0x...'
        };
        proof = await generateProof(input);
      } else if (proofType === 'payment') {
        // Generate proof of payment
        const note = allNotes.find(n => n.commitment === selectedNote);
        if (!note) {
          throw new Error('Selected note not found');
        }
        proof = generateProofOfPayment(note);
      }

      setGeneratedProof(proof);
      setProofStep('success');

    } catch (err) {
      console.error('Proof generation failed:', err);
      setProofStep('form');
    }
  };

  const handleVerifyProof = async () => {
    if (!generatedProof) {
      showInfoModal('No proof to verify', 'Generate a proof first.');
      return;
    }

    try {
      clearError();
      let result;

      if (proofType === 'transfer') {
        // Verify transfer proof
        result = await verifyProof(
          generatedProof.proof,
          generatedProof.publicSignals,
          generatedProof.verifierKey
        );
      } else if (proofType === 'payment') {
        // Verify proof of payment
        const note = allNotes.find(n => n.commitment === selectedNote);
        result = verifyProofOfPayment(generatedProof, note, viewKey);
      }

      setVerificationResult(result);

    } catch (err) {
      console.error('Proof verification failed:', err);
      setVerificationResult(false);
    }
  };

  const handleExportViewKey = () => {
    try {
      const key = exportViewKey();
      setViewKey(key);
    } catch (err) {
      console.error('Failed to export view key:', err);
    }
  };

  const formatNote = (note) => {
    return `${note.commitment?.slice(0, 8)}... (${Number(note.amount) / 1e18} ETH)`;
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
              <h1 className="text-3xl font-bold text-gray-900">Zero-Knowledge Proofs</h1>
              <p className="mt-2 text-gray-600">
                Generate and verify privacy-preserving proofs
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
                <h3 className="text-sm font-medium text-red-800">Proof Error</h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>{error}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Proof Type Selection */}
        <div className="bg-white overflow-hidden shadow rounded-lg mb-6">
          <div className="px-4 py-5 sm:p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Proof Type</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex items-center p-4 border border-gray-200 rounded-lg hover:bg-gray-50">
                <input
                  type="radio"
                  value="transfer"
                  checked={proofType === 'transfer'}
                  onChange={(e) => setProofType(e.target.value)}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                />
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-900">Transfer Proof</p>
                  <p className="text-sm text-gray-500">Generate proof for a shielded transfer</p>
                </div>
              </label>
              <label className="flex items-center p-4 border border-gray-200 rounded-lg hover:bg-gray-50">
                <input
                  type="radio"
                  value="payment"
                  checked={proofType === 'payment'}
                  onChange={(e) => setProofType(e.target.value)}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                />
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-900">Payment Proof</p>
                  <p className="text-sm text-gray-500">Generate proof of payment for a specific note</p>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Proof Generation Form */}
        {proofStep === 'form' && (
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Generate Proof</h2>
              <form onSubmit={handleGenerateProof} className="space-y-6">
                {proofType === 'payment' && (
                  <div>
                    <label htmlFor="note" className="block text-sm font-medium text-gray-700">
                      Select Note
                    </label>
                    <select
                      id="note"
                      value={selectedNote}
                      onChange={(e) => setSelectedNote(e.target.value)}
                      required
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    >
                      <option value="">Select a note...</option>
                      {allNotes.map((note, index) => (
                        <option key={index} value={note.commitment}>
                          {formatNote(note)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {proofType === 'transfer' && (
                  <div>
                    <label htmlFor="input" className="block text-sm font-medium text-gray-700">
                      Transfer Input (JSON)
                    </label>
                    <textarea
                      id="input"
                      value={proofInput}
                      onChange={(e) => setProofInput(e.target.value)}
                      required
                      rows={4}
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder='{"amount": "1000000000000000000", "recipient": "0x...", ...}'
                    />
                  </div>
                )}

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
                    {loading ? 'Generating...' : 'Generate Proof'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Proof Generation Progress */}
        {proofStep === 'generating' && (
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
              <h3 className="text-lg font-medium text-gray-900">Generating Proof</h3>
              <p className="text-gray-600">This may take a few moments...</p>
            </div>
          </div>
        )}

        {/* Generated Proof Display */}
        {proofStep === 'success' && generatedProof && (
          <div className="space-y-6">
            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-medium text-gray-900">Generated Proof</h2>
                  <div className="flex space-x-2">
                    <button
                      onClick={handleVerifyProof}
                      className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md text-sm font-medium"
                    >
                      Verify Proof
                    </button>
                    <button
                      onClick={() => setProofStep('form')}
                      className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium"
                    >
                      Generate New
                    </button>
                  </div>
                </div>

                <div className="bg-gray-50 p-4 rounded-lg">
                  <pre className="text-sm text-gray-900 overflow-x-auto">
                    {JSON.stringify(generatedProof, null, 2)}
                  </pre>
                </div>

                {verificationResult !== null && (
                  <div className={`mt-4 p-4 rounded-lg ${verificationResult ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
                    }`}>
                    <div className="flex">
                      <div className="ml-3">
                        <h3 className={`text-sm font-medium ${verificationResult ? 'text-green-800' : 'text-red-800'
                          }`}>
                          Proof Verification {verificationResult ? 'Successful' : 'Failed'}
                        </h3>
                        <div className={`mt-2 text-sm ${verificationResult ? 'text-green-700' : 'text-red-700'
                          }`}>
                          <p>
                            {verificationResult
                              ? 'The proof has been verified successfully.'
                              : 'The proof verification failed. Please check the input parameters.'
                            }
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* View Key Management (for payment proofs) */}
            {proofType === 'payment' && (
              <div className="bg-white overflow-hidden shadow rounded-lg">
                <div className="px-4 py-5 sm:p-6">
                  <h2 className="text-lg font-medium text-gray-900 mb-4">View Key Management</h2>
                  <div className="space-y-4">
                    <button
                      onClick={handleExportViewKey}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium"
                    >
                      Export View Key
                    </button>
                    {viewKey && (
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <p className="text-sm text-gray-600 mb-2">Your View Key:</p>
                        <p className="text-sm font-mono text-gray-900 break-all">{viewKey}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
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

export default Proof; 