import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Info } from 'lucide-react';
import { useCipherPay } from '../contexts/CipherPayContext';
import MessageModal from './MessageModal';

function Auditor() {
  const navigate = useNavigate();
  const {
    isConnected,
    verifyProof,
    verifyProofOfPayment,
    fetchMerkleRoot,
    getMerklePath,
    loading,
    error,
    clearError
  } = useCipherPay();

  const [auditType, setAuditType] = useState('proof'); // proof, merkle, payment
  const [proofData, setProofData] = useState('');
  const [merkleRoot, setMerkleRoot] = useState('');
  const [commitment, setCommitment] = useState('');
  const [merklePath, setMerklePath] = useState(null);
  const [paymentProof, setPaymentProof] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [viewKey, setViewKey] = useState('');
  const [auditResult, setAuditResult] = useState(null);
  const [auditStep, setAuditStep] = useState('form'); // form, auditing, success
  const [infoModal, setInfoModal] = useState(null); // { title, message }
  const showInfoModal = (title, message) => setInfoModal({ title, message });

  useEffect(() => {
    if (!isConnected) {
      navigate('/');
    }
  }, [isConnected, navigate]);

  const handleVerifyProof = async (e) => {
    e.preventDefault();

    if (!isConnected) {
      showInfoModal('Wallet required', 'Please connect your wallet first.');
      return;
    }

    try {
      clearError();
      setAuditStep('auditing');
      setAuditResult(null);

      let result;
      if (auditType === 'proof') {
        // Verify transfer proof
        const proofObj = JSON.parse(proofData);
        result = await verifyProof(
          proofObj.proof,
          proofObj.publicSignals,
          proofObj.verifierKey
        );
      } else if (auditType === 'payment') {
        // Verify payment proof
        result = verifyProofOfPayment(paymentProof, paymentNote, viewKey);
      }

      setAuditResult(result);
      setAuditStep('success');

    } catch (err) {
      console.error('Audit failed:', err);
      setAuditResult(false);
      setAuditStep('success');
    }
  };

  const handleFetchMerkleRoot = async () => {
    try {
      clearError();
      const root = await fetchMerkleRoot();
      setMerkleRoot(root);
    } catch (err) {
      console.error('Failed to fetch Merkle root:', err);
    }
  };

  const handleGetMerklePath = async () => {
    if (!commitment) {
      showInfoModal('Commitment required', 'Please enter a commitment.');
      return;
    }

    try {
      clearError();
      const path = await getMerklePath(commitment);
      setMerklePath(path);
    } catch (err) {
      console.error('Failed to get Merkle path:', err);
    }
  };

  const resetForm = () => {
    setProofData('');
    setMerkleRoot('');
    setCommitment('');
    setMerklePath(null);
    setPaymentProof('');
    setPaymentNote('');
    setViewKey('');
    setAuditResult(null);
    setAuditStep('form');
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
              <h1 className="text-3xl font-bold text-gray-900">Auditor View</h1>
              <p className="mt-2 text-gray-600">
                Verify proofs and audit transaction integrity
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
                <h3 className="text-sm font-medium text-red-800">Audit Error</h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>{error}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Audit Type Selection */}
        <div className="bg-white overflow-hidden shadow rounded-lg mb-6">
          <div className="px-4 py-5 sm:p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Audit Type</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="flex items-center p-4 border border-gray-200 rounded-lg hover:bg-gray-50">
                <input
                  type="radio"
                  value="proof"
                  checked={auditType === 'proof'}
                  onChange={(e) => setAuditType(e.target.value)}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                />
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-900">Proof Verification</p>
                  <p className="text-sm text-gray-500">Verify zero-knowledge proofs</p>
                </div>
              </label>
              <label className="flex items-center p-4 border border-gray-200 rounded-lg hover:bg-gray-50">
                <input
                  type="radio"
                  value="merkle"
                  checked={auditType === 'merkle'}
                  onChange={(e) => setAuditType(e.target.value)}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                />
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-900">Merkle Tree</p>
                  <p className="text-sm text-gray-500">Audit Merkle tree integrity</p>
                </div>
              </label>
              <label className="flex items-center p-4 border border-gray-200 rounded-lg hover:bg-gray-50">
                <input
                  type="radio"
                  value="payment"
                  checked={auditType === 'payment'}
                  onChange={(e) => setAuditType(e.target.value)}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                />
                <div className="ml-3">
                  <p className="text-sm font-medium text-gray-900">Payment Proof</p>
                  <p className="text-sm text-gray-500">Verify payment proofs</p>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Proof Verification Form */}
        {auditType === 'proof' && auditStep === 'form' && (
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Verify Proof</h2>
              <form onSubmit={handleVerifyProof} className="space-y-6">
                <div>
                  <label htmlFor="proofData" className="block text-sm font-medium text-gray-700">
                    Proof Data (JSON)
                  </label>
                  <textarea
                    id="proofData"
                    value={proofData}
                    onChange={(e) => setProofData(e.target.value)}
                    required
                    rows={8}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    placeholder='{"proof": {...}, "publicSignals": [...], "verifierKey": {...}}'
                  />
                </div>

                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium"
                  >
                    Reset
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
                  >
                    {loading ? 'Verifying...' : 'Verify Proof'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Merkle Tree Audit */}
        {auditType === 'merkle' && (
          <div className="space-y-6">
            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <h2 className="text-lg font-medium text-gray-900 mb-4">Merkle Root</h2>
                <div className="space-y-4">
                  <button
                    onClick={handleFetchMerkleRoot}
                    disabled={loading}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
                  >
                    {loading ? 'Fetching...' : 'Fetch Current Root'}
                  </button>
                  {merkleRoot && (
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-sm text-gray-600 mb-2">Current Merkle Root:</p>
                      <p className="text-sm font-mono text-gray-900 break-all">{merkleRoot}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <h2 className="text-lg font-medium text-gray-900 mb-4">Merkle Path</h2>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="commitment" className="block text-sm font-medium text-gray-700">
                      Commitment
                    </label>
                    <input
                      type="text"
                      id="commitment"
                      value={commitment}
                      onChange={(e) => setCommitment(e.target.value)}
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="0x..."
                    />
                  </div>
                  <button
                    onClick={handleGetMerklePath}
                    disabled={loading || !commitment}
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
                  >
                    {loading ? 'Getting Path...' : 'Get Merkle Path'}
                  </button>
                  {merklePath && (
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-sm text-gray-600 mb-2">Merkle Path:</p>
                      <pre className="text-sm text-gray-900 overflow-x-auto">
                        {JSON.stringify(merklePath, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Payment Proof Verification */}
        {auditType === 'payment' && auditStep === 'form' && (
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Verify Payment Proof</h2>
              <form onSubmit={handleVerifyProof} className="space-y-6">
                <div>
                  <label htmlFor="paymentProof" className="block text-sm font-medium text-gray-700">
                    Payment Proof
                  </label>
                  <textarea
                    id="paymentProof"
                    value={paymentProof}
                    onChange={(e) => setPaymentProof(e.target.value)}
                    required
                    rows={4}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    placeholder="Payment proof data..."
                  />
                </div>

                <div>
                  <label htmlFor="paymentNote" className="block text-sm font-medium text-gray-700">
                    Note Data
                  </label>
                  <textarea
                    id="paymentNote"
                    value={paymentNote}
                    onChange={(e) => setPaymentNote(e.target.value)}
                    required
                    rows={4}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    placeholder="Note data..."
                  />
                </div>

                <div>
                  <label htmlFor="viewKey" className="block text-sm font-medium text-gray-700">
                    View Key
                  </label>
                  <input
                    type="text"
                    id="viewKey"
                    value={viewKey}
                    onChange={(e) => setViewKey(e.target.value)}
                    required
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    placeholder="View key..."
                  />
                </div>

                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium"
                  >
                    Reset
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
                  >
                    {loading ? 'Verifying...' : 'Verify Payment Proof'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Audit Progress */}
        {auditStep === 'auditing' && (
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
              <h3 className="text-lg font-medium text-gray-900">Auditing</h3>
              <p className="text-gray-600">Verifying proof integrity...</p>
            </div>
          </div>
        )}

        {/* Audit Result */}
        {auditStep === 'success' && auditResult !== null && (
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <div className={`p-4 rounded-lg ${auditResult ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
                }`}>
                <div className="flex">
                  <div className="flex-shrink-0">
                    {auditResult ? (
                      <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                  <div className="ml-3">
                    <h3 className={`text-sm font-medium ${auditResult ? 'text-green-800' : 'text-red-800'
                      }`}>
                      Audit {auditResult ? 'Successful' : 'Failed'}
                    </h3>
                    <div className={`mt-2 text-sm ${auditResult ? 'text-green-700' : 'text-red-700'
                      }`}>
                      <p>
                        {auditResult
                          ? 'The proof has been verified and is valid.'
                          : 'The proof verification failed. The proof may be invalid or corrupted.'
                        }
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  onClick={resetForm}
                  className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium"
                >
                  New Audit
                </button>
              </div>
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

export default Auditor; 