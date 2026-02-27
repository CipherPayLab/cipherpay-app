import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCipherPay } from '../contexts/CipherPayContext';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { getAssociatedTokenAddressSync, NATIVE_MINT } from '@solana/spl-token';
import SolanaStatus from './SolanaStatus';
import SDKStatus from './SDKStatus';
import authService from '../services/authService';
import { decryptFromSenderForMe } from '../lib/e2ee';

function Dashboard() {
  const navigate = useNavigate();
  const { connection } = useConnection();
  const wallet = useWallet();
  const {
    isInitialized,
    isConnected,
    isAuthenticated,
    authUser,
    publicAddress,
    balance,
    spendableNotes,
    allNotes,
    loading,
    error,
    signOut,
    refreshData,
    createDeposit,
    approveRelayerDelegate,
    checkRelayerDelegateApproved,
    createTransfer,
    getWithdrawableNotes,
    createWithdraw
  } = useCipherPay();

  const [actionLoading, setActionLoading] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [approveAmount, setApproveAmount] = useState('10'); // Default approval for 10 SOL
  const [transferAmount, setTransferAmount] = useState('');
  const [transferRecipient, setTransferRecipient] = useState('');
  const [recipientLookupStatus, setRecipientLookupStatus] = useState(null); // null | 'loading' | 'found' | 'not_found'
  const [resolvedRecipientInfo, setResolvedRecipientInfo] = useState(null);
  const [showNoteSelectionModal, setShowNoteSelectionModal] = useState(false);
  const [withdrawableNotes, setWithdrawableNotes] = useState([]);
  const [selectedNoteForWithdraw, setSelectedNoteForWithdraw] = useState(null);
  const [isDelegateApproved, setIsDelegateApproved] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);
  const [copiedItem, setCopiedItem] = useState(null); // Track what was copied for feedback
  const [ataBalance, setAtaBalance] = useState(0);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [selectedNoteType, setSelectedNoteType] = useState(null); // 'spendable' or 'all'
  const [recentActivities, setRecentActivities] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalActivities, setTotalActivities] = useState(0);
  const [activitiesPerPage, setActivitiesPerPage] = useState(10);
  
  // Search filters state
  const [searchUsername, setSearchUsername] = useState('');
  const [searchKind, setSearchKind] = useState('');
  const [searchDateFrom, setSearchDateFrom] = useState('');
  const [searchDateTo, setSearchDateTo] = useState('');
  const [searchAmountMin, setSearchAmountMin] = useState('');
  const [searchAmountMax, setSearchAmountMax] = useState('');
  const [searchSignature, setSearchSignature] = useState('');
  const [showSearchFilters, setShowSearchFilters] = useState(false);

  const hasRedirected = useRef(false);
  const hasRefreshed = useRef(false);

  useEffect(() => {
    // CRITICAL: Redirect to login if not initialized, not connected, or not authenticated
    // This protects the dashboard from being accessed without proper authentication
    if (!isInitialized || !isConnected || !isAuthenticated) {
      // Always allow redirect if disconnected - don't block with flag
      // The flag only prevents multiple redirects during the same render cycle
      if (!hasRedirected.current) {
        hasRedirected.current = true;
        console.log('[Dashboard] Not authenticated or connected, redirecting to login', {
          isInitialized,
          isConnected,
          isAuthenticated
        });
        // Immediate redirect - no delay
        navigate('/', { replace: true });
      }
      return;
    }

    // Reset redirect flag when connected and authenticated (user can navigate back to dashboard)
    if (isInitialized && isConnected && isAuthenticated) {
      hasRedirected.current = false;
    }

    // Only proceed if initialized, connected, and authenticated
    // Refresh data once when component mounts and is ready
    if (!hasRefreshed.current) {
      hasRefreshed.current = true;
      refreshData();
    }
  }, [isInitialized, isConnected, isAuthenticated, navigate, refreshData]);

  // Fetch recent activities when authenticated
  useEffect(() => {
    if (isAuthenticated && authUser) {
      fetchRecentActivities();
    }
  }, [isAuthenticated, authUser]);

  // Check on-chain if relayer delegate is already approved (so we don't prompt every login)
  // Fallback: if user has shielded notes, they must have approved (deposits require it)
  useEffect(() => {
    const check = async () => {
      if (!wallet.publicKey || !connection || !checkRelayerDelegateApproved) return;
      try {
        const approved = await checkRelayerDelegateApproved({
          connection,
          walletPublicKey: wallet.publicKey.toBase58(),
        });
        setIsDelegateApproved(approved);
      } catch (err) {
        console.warn('[Dashboard] checkRelayerDelegateApproved:', err?.message);
      }
    };
    check();
  }, [wallet.publicKey, connection, checkRelayerDelegateApproved]);

  // Fallback: if user has shielded balance/notes, they've already approved (can't deposit without it)
  useEffect(() => {
    if ((spendableNotes?.length > 0 || allNotes?.length > 0) && !isDelegateApproved) {
      setIsDelegateApproved(true);
    }
  }, [spendableNotes?.length, allNotes?.length, isDelegateApproved]);

  // Fetch wallet balance and ATA balance
  useEffect(() => {
    const fetchBalances = async () => {
      if (!wallet.publicKey || !connection) {
        setWalletBalance(0);
        setAtaBalance(0);
        return;
      }

      try {
        // Fetch wallet SOL balance
        const balance = await connection.getBalance(wallet.publicKey);
        setWalletBalance(balance);

        // Fetch wSOL ATA balance
        try {
          const wsolMint = NATIVE_MINT;
          const ata = getAssociatedTokenAddressSync(wsolMint, wallet.publicKey, false);
          const ataInfo = await connection.getAccountInfo(ata);
          
          if (ataInfo) {
            const tokenAccount = await connection.getTokenAccountBalance(ata);
            setAtaBalance(Number(tokenAccount.value.amount));
          } else {
            setAtaBalance(0);
          }
        } catch (err) {
          console.error('Error fetching ATA balance:', err);
          setAtaBalance(0);
        }
      } catch (err) {
        console.error('Error fetching wallet balance:', err);
        setWalletBalance(0);
      }
    };

    fetchBalances();
    
    // Refresh balances periodically (every 5 seconds)
    const interval = setInterval(fetchBalances, 5000);
    
    return () => clearInterval(interval);
  }, [wallet.publicKey, connection, isConnected]);

  const handleDisconnect = async () => {
    try {
      console.log('[Dashboard] Disconnect button clicked, signing out...');
      // Sign out completely (clears both authentication and wallet connection)
      // This prevents the redirect loop by clearing isAuthenticated
      await signOut();
      console.log('[Dashboard] Sign out completed, navigating to login...');
      // Reset flags so user can reconnect later
      hasRedirected.current = false;
      hasRefreshed.current = false;
      // Navigate to login page immediately - the useEffect will also trigger but that's ok
      navigate('/', { replace: true });
    } catch (err) {
      console.error('[Dashboard] Failed to disconnect:', err);
      // Reset flags even on error
      hasRedirected.current = false;
      hasRefreshed.current = false;
      // Navigate even if sign out fails
      navigate('/', { replace: true });
    }
  };

  const formatAddress = (address) => {
    if (!address) return 'Not connected';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const formatBalance = (balance) => {
    // For Solana, 1 SOL = 1,000,000,000 lamports
    return Number(balance) / 1e9; // Convert lamports to SOL
  };


  const handleCopy = async (text, itemName) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedItem(itemName);
      setTimeout(() => setCopiedItem(null), 2000); // Clear after 2 seconds
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleShowNotes = (noteType) => {
    setSelectedNoteType(noteType);
    setShowNotesModal(true);
  };

  const formatNoteAmount = (amount) => {
    if (typeof amount === 'bigint' || typeof amount === 'number') {
      return (Number(amount) / 1e9).toFixed(4);
    }
    return '0';
  };

  const fetchRecentActivities = async (page = currentPage, limit = activitiesPerPage) => {
    try {
      const token = localStorage.getItem('cipherpay_token');
      console.log('[Dashboard] fetchRecentActivities: authUser:', authUser);
      console.log('[Dashboard] fetchRecentActivities: authUser keys:', authUser ? Object.keys(authUser) : 'null');
      
      if (!token) {
        console.log('[Dashboard] No token, skipping activities fetch');
        return;
      }
      
      if (!authUser) {
        console.log('[Dashboard] No authUser, skipping activities fetch');
        return;
      }

      // Try different property names for owner key
      const ownerKey = authUser.ownerKey || authUser.ownerCipherPayPubKey || authUser.owner_cipherpay_pub_key;
      console.log('[Dashboard] Owner key to use:', ownerKey);
      
      if (!ownerKey) {
        console.log('[Dashboard] No owner key found in authUser');
        return;
      }

      const offset = (page - 1) * limit;
      const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';
      
      // Build query parameters
      const params = new URLSearchParams({
        owner: ownerKey,
        limit: limit.toString(),
        offset: offset.toString(),
      });
      
      // Add search filters
      if (searchUsername.trim()) {
        params.append('username', searchUsername.trim().replace(/^@/, ''));
      }
      if (searchKind) {
        params.append('kind', searchKind);
      }
      if (searchDateFrom) {
        params.append('dateFrom', searchDateFrom);
      }
      if (searchDateTo) {
        params.append('dateTo', searchDateTo);
      }
      if (searchAmountMin) {
        params.append('amountMin', searchAmountMin);
      }
      if (searchAmountMax) {
        params.append('amountMax', searchAmountMax);
      }
      if (searchSignature.trim()) {
        params.append('signature', searchSignature.trim());
      }
      
      const url = `${SERVER_URL}/transactions?${params.toString()}`;
      console.log('[Dashboard] Fetching activities from:', url);
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      console.log('[Dashboard] Activities response status:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        
        // Handle both old format (array) and new format (object with activities)
        const activities = Array.isArray(data) ? data : (data.activities || []);
        const total = Array.isArray(data) ? data.length : (data.total || 0);
        
        console.log('[Dashboard] Fetched activities:', activities);
        console.log('[Dashboard] Total activities:', total);
        console.log('[Dashboard] Activity details:', activities.map(a => ({
          id: a.id,
          event: a.event,
          recipient_key: a.recipient_key?.slice(0, 20) + '...',
          sender_key: a.sender_key?.slice(0, 20) + '...',
          hasMessage: !!a.message,
          hasCiphertext: !!a.message?.ciphertext
        })));
        
        // Extract amounts from messages
        // Use amount field directly from message (unencrypted, stored in DB)
        const enrichedActivities = activities.map(activity => {
          let amount = null;
          
          // Use amount directly from message (stored in top-level message.amount field)
          if (activity.message?.amount) {
            // Amount is stored as string in DB, convert to number and divide by 1e9 to get SOL
            amount = Number(BigInt(activity.message.amount)) / 1e9;
            console.log('[Dashboard] Using amount from message field for activity', activity.id, ':', amount, 'SOL');
          } else {
            console.warn('[Dashboard] No amount found in message for activity', activity.id);
          }
          
          return {
            ...activity,
            amount,
          };
        });
        
        console.log('[Dashboard] Enriched activities with amounts:', enrichedActivities);
        setRecentActivities(enrichedActivities);
        setTotalActivities(total);
        setCurrentPage(page);
      } else {
        const errorText = await response.text();
        console.error('[Dashboard] Failed to fetch activities:', response.status, errorText);
      }
    } catch (err) {
      console.error('[Dashboard] Failed to fetch recent activities:', err);
    }
  };

  const getActivityIcon = (event) => {
    switch (event) {
      case 'DepositCompleted':
        return (
          <div className="bg-green-100 rounded-full p-2">
            <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </div>
        );
      case 'TransferCompleted':
        return (
          <div className="bg-blue-100 rounded-full p-2">
            <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>
        );
      case 'WithdrawCompleted':
        return (
          <div className="bg-orange-100 rounded-full p-2">
            <svg className="w-6 h-6 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </div>
        );
      default:
        return null;
    }
  };

  const getActivityType = (activity) => {
    if (!authUser?.ownerKey) {
      // Fallback to event-based type if no ownerKey
      switch (activity.event) {
        case 'DepositCompleted':
          return 'Deposit';
        case 'TransferCompleted':
          return 'Transfer';
        case 'WithdrawCompleted':
          return 'Withdrawal';
        default:
          return activity.event;
      }
    }

    // Check if this is a change output (sender === recipient === you)
    if (activity.event === 'TransferCompleted' && 
        activity.sender_key === authUser.ownerKey && 
        activity.recipient_key === authUser.ownerKey) {
      return 'Change';
    }

    // Regular event-based types
    switch (activity.event) {
      case 'DepositCompleted':
        return 'Deposit';
      case 'TransferCompleted':
        return 'Transfer';
      case 'WithdrawCompleted':
        return 'Withdrawal';
      default:
        return activity.event;
    }
  };

  const getActivityDirection = (activity) => {
    if (!authUser?.ownerKey) return '';
    
    // Change outputs don't need a direction label
    if (activity.event === 'TransferCompleted' && 
        activity.sender_key === authUser.ownerKey && 
        activity.recipient_key === authUser.ownerKey) {
      return '';
    }
    
    if (activity.event === 'DepositCompleted') {
      return 'Received';
    } else if (activity.event === 'TransferCompleted') {
      if (activity.recipient_key === authUser.ownerKey) {
        return 'Received';
      } else {
        return 'Sent';
      }
    } else if (activity.event === 'WithdrawCompleted') {
      return 'Withdrawn';
    }
    return '';
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    
    // Format as: "Jan 15, 2024, 2:30 PM" or "15 Jan 2024, 14:30" depending on locale
    // Using a consistent format that includes date and time
    const options = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    };
    
    return date.toLocaleString(undefined, options);
  };

  const formatRecipient = (activity) => {
    if (!activity || activity.event !== 'TransferCompleted') {
      return null;
    }

    if (!authUser?.ownerKey) {
      // Fallback: show username or shortened recipient key
      if (activity.recipient_username) {
        return `to @${activity.recipient_username}`;
      }
      return activity.recipient_key 
        ? `to ${activity.recipient_key.slice(0, 8)}...${activity.recipient_key.slice(-6)}`
        : null;
    }

    // For change (recipient === sender === you), show "to self"
    if (activity.sender_key === authUser.ownerKey && 
        activity.recipient_key === authUser.ownerKey) {
      return 'to self';
    }

    // For sent transfers, show recipient username or address
    if (activity.sender_key === authUser.ownerKey && 
        activity.recipient_key !== authUser.ownerKey) {
      if (activity.recipient_username) {
        return `to @${activity.recipient_username}`;
      }
      const recipientKey = activity.recipient_key || '';
      return `to ${recipientKey.slice(0, 8)}...${recipientKey.slice(-6)}`;
    }

    // For received transfers, show sender username or address
    if (activity.recipient_key === authUser.ownerKey && 
        activity.sender_key !== authUser.ownerKey) {
      if (activity.sender_username) {
        return `from @${activity.sender_username}`;
      }
      const senderKey = activity.sender_key || '';
      return `from ${senderKey.slice(0, 8)}...${senderKey.slice(-6)}`;
    }

    return null;
  };

  const handleApproveDelegate = async () => {
    if (!approveAmount || parseFloat(approveAmount) <= 0) {
      alert('Please enter a valid approval amount');
      return;
    }
    try {
      setActionLoading(true);
      const amountInLamports = BigInt(Math.floor(parseFloat(approveAmount) * 1e9));
      
      const approvalParams = {
        connection,
        wallet,
        tokenMint: 'So11111111111111111111111111111111111111112', // Native SOL (Wrapped SOL)
        amount: amountInLamports,
      };
      
      console.log('[Dashboard] Approving relayer delegate with params:', approvalParams);
      const result = await approveRelayerDelegate(approvalParams);
      console.log('[Dashboard] Delegate approval successful:', result);
      
      setIsDelegateApproved(true);
      setShowApproveModal(false);
      setApproveAmount('10');
      
      alert(`Delegate approved! You can now make deposits. Transaction: ${result?.signature || 'success'}`);
    } catch (err) {
      console.error('[Dashboard] Failed to approve delegate:', err);
      alert(`Delegate approval failed: ${err.message || 'Unknown error'}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) {
      alert('Please enter a valid deposit amount');
      return;
    }
    
    // Check if delegate approval is needed
    if (!isDelegateApproved) {
      const shouldApprove = confirm('You need to approve the relayer as a delegate before making your first deposit. Would you like to approve now?');
      if (shouldApprove) {
        setShowDepositModal(false);
        setShowApproveModal(true);
        return;
      } else {
        return;
      }
    }
    
    try {
      setActionLoading(true);
      const amountInLamports = BigInt(Math.floor(parseFloat(depositAmount) * 1e9));
      
      // Prepare deposit parameters with proper structure
      const depositParams = {
        amount: amountInLamports,
        tokenMint: 'So11111111111111111111111111111111111111112', // Native SOL (Wrapped SOL)
        tokenSymbol: 'SOL',
        decimals: 9,
        memo: 0,
      };
      
      console.log('[Dashboard] Creating deposit with params:', depositParams);
      const result = await createDeposit(depositParams);
      console.log('[Dashboard] Deposit successful:', result);
      
      setShowDepositModal(false);
      setDepositAmount('');
      await refreshData();
      
      alert(`Deposit successful! Transaction: ${result?.txHash || result?.signature || 'pending'}`);
    } catch (err) {
      console.error('[Dashboard] Failed to deposit:', err);
      alert(`Deposit failed: ${err.message || 'Unknown error'}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Close transfer modal and reset state
  const closeTransferModal = () => {
    setShowTransferModal(false);
    setTransferAmount('');
    setTransferRecipient('');
    setRecipientLookupStatus(null);
    setResolvedRecipientInfo(null);
  };

  // Handle recipient input change (for username lookup)
  const handleRecipientChange = async (e) => {
    const value = e.target.value;
    setTransferRecipient(value);
    setRecipientLookupStatus(null);
    setResolvedRecipientInfo(null);
    
    // Skip lookup if empty or too short
    if (!value || value.trim().length < 3) {
      return;
    }
    
    const trimmedValue = value.trim();
    
    // Check if input looks like a username (starts with @ or doesn't look like hex)
    const isUsername = trimmedValue.startsWith('@') || !/^(0x)?[0-9a-fA-F]{64,}$/.test(trimmedValue);
    
    if (isUsername) {
      // Extract username (remove @ if present)
      const username = trimmedValue.startsWith('@') ? trimmedValue.slice(1) : trimmedValue;
      
      // Perform lookup
      setRecipientLookupStatus('loading');
      try {
        const result = await authService.lookupUserByUsername(username);
        if (result.success && result.user) {
          setRecipientLookupStatus('found');
          setResolvedRecipientInfo({
            username: result.user.username,
            publicKey: result.user.ownerCipherPayPubKey
          });
          console.log('[Dashboard] Resolved @' + username + ' to:', result.user.ownerCipherPayPubKey);
        } else {
          setRecipientLookupStatus('not_found');
          console.log('[Dashboard] User @' + username + ' not found');
        }
      } catch (error) {
        console.error('[Dashboard] Username lookup failed:', error);
        setRecipientLookupStatus('not_found');
      }
    }
  };

  const handleTransfer = async () => {
    if (!transferAmount || parseFloat(transferAmount) <= 0) {
      alert('Please enter a valid transfer amount');
      return;
    }
    if (!transferRecipient || transferRecipient.trim() === '') {
      alert('Please enter a recipient address or username');
      return;
    }
    
    // If username lookup is still in progress, wait
    if (recipientLookupStatus === 'loading') {
      alert('Please wait while we look up the username...');
      return;
    }
    
    // If username was not found
    if (recipientLookupStatus === 'not_found') {
      alert('User not found. Please check the username or enter a valid public key.');
      return;
    }
    
    try {
      setActionLoading(true);
      
      // Determine the actual recipient public key
      let recipientPubKey = transferRecipient.trim();
      
      // If we resolved a username, use that public key
      if (recipientLookupStatus === 'found' && resolvedRecipientInfo?.publicKey) {
        recipientPubKey = resolvedRecipientInfo.publicKey;
        console.log('[Dashboard] Using resolved public key for @' + resolvedRecipientInfo.username + ':', recipientPubKey);
      }
      
      const amountInLamports = BigInt(Math.floor(parseFloat(transferAmount) * 1e9));
      const transaction = await createTransfer(recipientPubKey, amountInLamports);
      console.log('Transfer successful:', transaction);
      
      // Store recipient info for success message before closing modal
      const recipientDisplay = resolvedRecipientInfo ? `@${resolvedRecipientInfo.username}` : recipientPubKey.slice(0, 8) + '...';
      
      closeTransferModal();
      await refreshData();
      
      const txHash = transaction?.id || transaction?.txHash || 'pending';
      alert(`Transfer successful to ${recipientDisplay}! Transaction: ${txHash}`);
    } catch (err) {
      console.error('Failed to transfer:', err);
      alert(`Transfer failed: ${err.message || 'Unknown error'}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Handle withdraw button click - check note count and proceed accordingly
  const handleWithdrawClick = async () => {
    try {
      setActionLoading(true);
      
      // Get withdrawable notes
      const notes = await getWithdrawableNotes();
      
      if (notes.length === 0) {
        alert('No withdrawable notes available. Please deposit funds first.');
        return;
      }
      
      // Use connected wallet address as recipient
      const recipientAddress = publicAddress;
      if (!recipientAddress) {
        alert('Please connect your wallet first');
        return;
      }
      
      if (notes.length === 1) {
        // Only one note: automatically withdraw the full amount
        console.log('[Dashboard] Only one note available, auto-withdrawing:', notes[0]);
        await executeWithdraw(notes[0], recipientAddress);
      } else {
        // Multiple notes: show selection modal
        console.log('[Dashboard] Multiple notes available, showing selection modal:', notes.length);
        setWithdrawableNotes(notes);
        setShowNoteSelectionModal(true);
      }
    } catch (err) {
      console.error('Failed to get withdrawable notes:', err);
      alert(`Failed to get withdrawable notes: ${err.message || 'Unknown error'}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Execute withdraw with selected note
  const executeWithdraw = async (note, recipientAddress) => {
    try {
      setActionLoading(true);
      const result = await createWithdraw(note, recipientAddress);
      console.log('Withdraw successful:', result);
      setShowNoteSelectionModal(false);
      setSelectedNoteForWithdraw(null);
      setWithdrawableNotes([]);
      await refreshData();
      alert(`Withdraw successful! Amount: ${note.amountFormatted || (Number(note.amount) / 1e9).toFixed(9) + ' SOL'}\nTransaction: ${result.txHash || result.signature || 'pending'}`);
    } catch (err) {
      console.error('Failed to withdraw:', err);
      alert(`Withdraw failed: ${err.message || 'Unknown error'}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Handle note selection from modal
  const handleNoteSelect = (note) => {
    setSelectedNoteForWithdraw(note);
    setShowNoteSelectionModal(false);
    
    // Use connected wallet address as recipient
    const recipientAddress = publicAddress;
    if (!recipientAddress) {
      alert('Please connect your wallet first');
      return;
    }
    
    // Execute withdraw with selected note
    executeWithdraw(note, recipientAddress);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">Loading Dashboard...</h2>
        </div>
      </div>
    );
  }

  // Don't render dashboard content if not authenticated
  // This prevents flash of content before redirect
  if (!isInitialized || !isConnected || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mb-4">
            <svg className="animate-spin h-8 w-8 text-indigo-600 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <p className="text-lg text-gray-600">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">CipherPay Solana Dashboard</h1>
                {authUser?.username && (
                  <p className="text-sm text-gray-600 mt-1">Welcome, @{authUser.username}</p>
                )}
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right space-y-1">
                {authUser?.username && (
                  <button
                    onClick={() => handleCopy(authUser.username, 'username')}
                    className="flex items-center space-x-2 text-sm font-medium text-gray-900 hover:text-indigo-600 transition-colors group"
                    title="Click to copy username"
                  >
                    <span>@{authUser.username}</span>
                    {copiedItem === 'username' ? (
                      <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                )}
                <button
                  onClick={() => handleCopy(publicAddress, 'address')}
                  className="flex items-center space-x-2 text-xs text-gray-500 hover:text-indigo-600 transition-colors group"
                  title="Click to copy full address"
                >
                  <span className="font-mono">{formatAddress(publicAddress)}</span>
                  {copiedItem === 'address' ? (
                    <svg className="w-3 h-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              </div>
              <button
                onClick={handleDisconnect}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium"
              >
                Disconnect
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Error</h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>{error}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Account Overview */}
        <div className="bg-white overflow-hidden shadow rounded-lg mb-6">
          <div className="px-4 py-5 sm:p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Account Overview</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <dt className="text-sm font-medium text-gray-500">Wallet Balance</dt>
                <dd className="mt-1 text-3xl font-semibold text-gray-900">
                  {formatBalance(walletBalance)} SOL
                </dd>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg">
                <dt className="text-sm font-medium text-gray-500">User ATA Balance</dt>
                <dd className="mt-1 text-3xl font-semibold text-gray-900">
                  {formatBalance(ataBalance)} SOL
                </dd>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <dt className="text-sm font-medium text-gray-500">Shielded Balance</dt>
                <dd className="mt-1 text-3xl font-semibold text-gray-900">
                  {formatBalance(balance)} SOL
                </dd>
              </div>
              <div 
                className="bg-gray-50 p-4 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() => handleShowNotes('spendable')}
                title="Click to view spendable notes details"
              >
                <dt className="text-sm font-medium text-gray-500 flex items-center">
                  Spendable Notes
                  <svg className="w-4 h-4 ml-2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </dt>
                <dd className="mt-1 text-3xl font-semibold text-gray-900">
                  {spendableNotes.length}
                </dd>
              </div>
              <div 
                className="bg-gray-50 p-4 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() => handleShowNotes('all')}
                title="Click to view all notes details"
              >
                <dt className="text-sm font-medium text-gray-500 flex items-center">
                  Total Notes
                  <svg className="w-4 h-4 ml-2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </dt>
                <dd className="mt-1 text-3xl font-semibold text-gray-900">
                  {allNotes.length}
                </dd>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="bg-white overflow-hidden shadow rounded-lg mb-6">
          <div className="px-4 py-5 sm:p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Actions</h2>
            
            {/* Show approve delegate button if not approved */}
            {!isDelegateApproved && (
              <div className="mb-4 p-4 bg-yellow-50 border-l-4 border-yellow-400 rounded">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-yellow-700">
                      Before making your first deposit, you need to approve the relayer as a delegate for your tokens.
                      <button
                        onClick={() => setShowApproveModal(true)}
                        className="ml-2 font-medium underline text-yellow-700 hover:text-yellow-600"
                      >
                        Approve Now
                      </button>
                    </p>
                  </div>
                </div>
              </div>
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Deposit */}
              <button
                onClick={() => setShowDepositModal(true)}
                disabled={actionLoading}
                className="relative group bg-white p-6 focus-within:ring-2 focus-within:ring-inset focus-within:ring-indigo-500 border border-gray-200 rounded-lg hover:border-indigo-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div>
                  <span className="rounded-lg inline-flex p-3 bg-green-50 text-green-700 ring-4 ring-white">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  </span>
                </div>
                <div className="mt-8">
                  <h3 className="text-lg font-medium text-left">Deposit</h3>
                  <p className="mt-2 text-sm text-gray-500 text-left">
                    Deposit funds into your shielded account
                  </p>
                </div>
              </button>

              {/* Transfer */}
              <button
                onClick={() => setShowTransferModal(true)}
                disabled={actionLoading}
                className="relative group bg-white p-6 focus-within:ring-2 focus-within:ring-inset focus-within:ring-indigo-500 border border-gray-200 rounded-lg hover:border-indigo-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div>
                  <span className="rounded-lg inline-flex p-3 bg-blue-50 text-blue-700 ring-4 ring-white">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                  </span>
                </div>
                <div className="mt-8">
                  <h3 className="text-lg font-medium text-left">Transfer</h3>
                  <p className="mt-2 text-sm text-gray-500 text-left">
                    Transfer funds to another shielded account
                  </p>
                </div>
              </button>

              {/* Withdraw */}
              <button
                onClick={handleWithdrawClick}
                disabled={actionLoading}
                className="relative group bg-white p-6 focus-within:ring-2 focus-within:ring-inset focus-within:ring-indigo-500 border border-gray-200 rounded-lg hover:border-indigo-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div>
                  <span className="rounded-lg inline-flex p-3 bg-red-50 text-red-700 ring-4 ring-white">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                    </svg>
                  </span>
                </div>
                <div className="mt-8">
                  <h3 className="text-lg font-medium text-left">Withdraw</h3>
                  <p className="mt-2 text-sm text-gray-500 text-left">
                    Withdraw funds from your shielded account
                  </p>
                </div>
              </button>
            </div>
          </div>
        </div>


        {/* Solana Integration Status */}
        <div className="mb-6">
          <SolanaStatus />
        </div>

        {/* SDK Status */}
        <div className="mb-6">
          <SDKStatus />
        </div>

        {/* All Activities */}
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-medium text-gray-900">All Activities</h2>
              <div className="flex items-center space-x-3">
                <label htmlFor="activitiesPerPage" className="text-sm text-gray-600">
                  Per page:
                </label>
                <select
                  id="activitiesPerPage"
                  value={activitiesPerPage}
                  onChange={(e) => {
                    const newLimit = parseInt(e.target.value);
                    setActivitiesPerPage(newLimit);
                    setCurrentPage(1); // Reset to first page when limit changes
                    fetchRecentActivities(1, newLimit);
                  }}
                  className="text-sm border border-gray-300 rounded-md px-2 py-1 text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <button
                  onClick={() => fetchRecentActivities(currentPage)}
                  className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center"
                  title="Refresh activities"
                >
                  <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Refresh
                </button>
              </div>
            </div>
            
            {/* Search Filters */}
            <div className="mb-4 border-b border-gray-200 pb-4">
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={() => setShowSearchFilters(!showSearchFilters)}
                  className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center"
                >
                  <svg className={`w-4 h-4 mr-1 transition-transform ${showSearchFilters ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                  {showSearchFilters ? 'Hide' : 'Show'} Search Filters
                </button>
                {(searchUsername || searchKind || searchDateFrom || searchDateTo || searchAmountMin || searchAmountMax || searchSignature) && (
                  <button
                    onClick={() => {
                      setSearchUsername('');
                      setSearchKind('');
                      setSearchDateFrom('');
                      setSearchDateTo('');
                      setSearchAmountMin('');
                      setSearchAmountMax('');
                      setSearchSignature('');
                      setCurrentPage(1);
                      fetchRecentActivities(1, activitiesPerPage);
                    }}
                    className="text-sm text-red-600 hover:text-red-800"
                  >
                    Clear All
                  </button>
                )}
              </div>
              
              {showSearchFilters && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
                  {/* Username Search */}
                  <div>
                    <label htmlFor="searchUsername" className="block text-sm font-medium text-gray-700 mb-1">
                      Username
                    </label>
                    <input
                      type="text"
                      id="searchUsername"
                      value={searchUsername}
                      onChange={(e) => setSearchUsername(e.target.value)}
                      placeholder="@username"
                      className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                  
                  {/* Transaction Type */}
                  <div>
                    <label htmlFor="searchKind" className="block text-sm font-medium text-gray-700 mb-1">
                      Type
                    </label>
                    <select
                      id="searchKind"
                      value={searchKind}
                      onChange={(e) => setSearchKind(e.target.value)}
                      className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    >
                      <option value="">All Types</option>
                      <option value="deposit">Deposit</option>
                      <option value="transfer">Transfer</option>
                      <option value="withdraw">Withdraw</option>
                    </select>
                  </div>
                  
                  {/* Date From */}
                  <div>
                    <label htmlFor="searchDateFrom" className="block text-sm font-medium text-gray-700 mb-1">
                      Date From
                    </label>
                    <input
                      type="date"
                      id="searchDateFrom"
                      value={searchDateFrom}
                      onChange={(e) => setSearchDateFrom(e.target.value)}
                      className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                  
                  {/* Date To */}
                  <div>
                    <label htmlFor="searchDateTo" className="block text-sm font-medium text-gray-700 mb-1">
                      Date To
                    </label>
                    <input
                      type="date"
                      id="searchDateTo"
                      value={searchDateTo}
                      onChange={(e) => setSearchDateTo(e.target.value)}
                      className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                  
                  {/* Amount Min */}
                  <div>
                    <label htmlFor="searchAmountMin" className="block text-sm font-medium text-gray-700 mb-1">
                      Min Amount (SOL)
                    </label>
                    <input
                      type="number"
                      id="searchAmountMin"
                      value={searchAmountMin}
                      onChange={(e) => setSearchAmountMin(e.target.value)}
                      placeholder="0.0"
                      step="0.0001"
                      min="0"
                      className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                  
                  {/* Amount Max */}
                  <div>
                    <label htmlFor="searchAmountMax" className="block text-sm font-medium text-gray-700 mb-1">
                      Max Amount (SOL)
                    </label>
                    <input
                      type="number"
                      id="searchAmountMax"
                      value={searchAmountMax}
                      onChange={(e) => setSearchAmountMax(e.target.value)}
                      placeholder="0.0"
                      step="0.0001"
                      min="0"
                      className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                  
                  {/* Signature */}
                  <div>
                    <label htmlFor="searchSignature" className="block text-sm font-medium text-gray-700 mb-1">
                      Transaction Signature
                    </label>
                    <input
                      type="text"
                      id="searchSignature"
                      value={searchSignature}
                      onChange={(e) => setSearchSignature(e.target.value)}
                      placeholder="Enter signature"
                      className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                </div>
              )}
              
              {showSearchFilters && (
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={() => {
                      setCurrentPage(1);
                      fetchRecentActivities(1, activitiesPerPage);
                    }}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  >
                    Apply Filters
                  </button>
                </div>
              )}
            </div>
            
            {recentActivities.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <p className="text-sm">No recent activity</p>
                <p className="text-xs text-gray-400 mt-1">Your transactions will appear here</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentActivities.map((activity, index) => (
                  <div key={activity.id || index} className="flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors">
                    <div className="flex items-center space-x-4">
                      {getActivityIcon(activity.event)}
                      <div>
                        <div className="flex items-center space-x-2">
                          <p className="text-sm font-medium text-gray-900">
                            {getActivityType(activity)}
                          </p>
                          {getActivityDirection(activity) && (
                            <span className="text-xs text-gray-500">
                              {getActivityDirection(activity)}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {formatTimestamp(activity.timestamp)}
                        </p>
                        {formatRecipient(activity) && (
                          <p className="text-xs text-gray-400 mt-0.5 font-mono">
                            {formatRecipient(activity)}
                          </p>
                        )}
                        {activity.signature && (
                          <a
                            href={`https://explorer.solana.com/tx/${activity.signature}?cluster=custom&customUrl=http://127.0.0.1:8899`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-indigo-600 hover:text-indigo-800 font-mono"
                          >
                            {activity.signature.slice(0, 8)}...
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-semibold ${
                        (getActivityDirection(activity) === 'Received' || getActivityType(activity) === 'Change') 
                          ? 'text-green-600' 
                          : getActivityDirection(activity) === 'Sent'
                          ? 'text-red-600'
                          : 'text-gray-900'
                      }`}>
                        {getActivityDirection(activity) === 'Sent' ? '-' : 
                         (getActivityDirection(activity) === 'Received' || getActivityType(activity) === 'Change') ? '+' : ''}
                        {activity.amount !== null && activity.amount !== undefined 
                          ? activity.amount.toFixed(4)
                          : (getActivityDirection(activity) === 'Sent' ? 'Sent' : '?')}
                        {(activity.amount !== null && activity.amount !== undefined) && (
                          <span className="text-gray-400 text-xs ml-1">SOL</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {/* Pagination Controls */}
            {totalActivities > activitiesPerPage && (
              <>
                <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4">
                  <div className="flex items-center space-x-2">
                    {Array.from({ length: Math.ceil(totalActivities / activitiesPerPage) }, (_, i) => i + 1)
                      .filter(page => {
                        // Show first page, last page, current page, and pages around current
                        const totalPages = Math.ceil(totalActivities / activitiesPerPage);
                        if (totalPages <= 7) return true; // Show all if 7 or fewer pages
                        if (page === 1 || page === totalPages) return true; // Always show first and last
                        if (Math.abs(page - currentPage) <= 1) return true; // Show current ± 1
                        return false;
                      })
                      .map((page, index, array) => {
                        // Add ellipsis between non-consecutive pages
                        const prevPage = array[index - 1];
                        const showEllipsisBefore = prevPage && page - prevPage > 1;
                        
                        return (
                          <div key={page} className="flex items-center">
                            {showEllipsisBefore && (
                              <span className="px-2 text-gray-500">...</span>
                            )}
                            <button
                              onClick={() => fetchRecentActivities(page)}
                              className={`px-3 py-1.5 text-sm font-medium rounded-md ${
                                currentPage === page
                                  ? 'bg-indigo-600 text-white'
                                  : 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              {page}
                            </button>
                          </div>
                        );
                      })}
                  </div>
                </div>
                
                {/* Simple Navigation Buttons */}
                <div className="mt-4 flex items-center justify-center space-x-2">
                  <button
                    onClick={() => fetchRecentActivities(1)}
                    disabled={currentPage === 1}
                    className="px-4 py-2 text-lg font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="First page"
                  >
                    &laquo;
                  </button>
                  <button
                    onClick={() => fetchRecentActivities(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="px-4 py-2 text-lg font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Previous page"
                  >
                    &lsaquo;
                  </button>
                  <button
                    onClick={() => fetchRecentActivities(currentPage + 1)}
                    disabled={currentPage >= Math.ceil(totalActivities / activitiesPerPage)}
                    className="px-4 py-2 text-lg font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Next page"
                  >
                    &rsaquo;
                  </button>
                  <button
                    onClick={() => fetchRecentActivities(Math.ceil(totalActivities / activitiesPerPage))}
                    disabled={currentPage >= Math.ceil(totalActivities / activitiesPerPage)}
                    className="px-4 py-2 text-lg font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Last page"
                  >
                    &raquo;
                  </button>
                </div>
              </>
            )}
            
            {/* Page info */}
            {totalActivities > 0 && (
              <div className="mt-2 text-xs text-gray-500 text-center">
                Showing {((currentPage - 1) * activitiesPerPage) + 1} to {Math.min(currentPage * activitiesPerPage, totalActivities)} of {totalActivities} activities
              </div>
            )}
          </div>
        </div>

        {/* Approve Delegate Modal */}
        {showApproveModal && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50" onClick={() => setShowApproveModal(false)}>
            <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white" onClick={(e) => e.stopPropagation()}>
              <div className="mt-3">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Approve Relayer Delegate</h3>
                <p className="text-sm text-gray-600 mb-4">
                  This is a one-time setup that allows the relayer to process deposits on your behalf. 
                  You're approving the relayer to spend up to the specified amount of tokens from your wallet.
                </p>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Approval Amount (SOL)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={approveAmount}
                    onChange={(e) => setApproveAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="10.0"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Recommended: Approve enough for multiple deposits to avoid frequent approvals
                  </p>
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => {
                      setShowApproveModal(false);
                      setApproveAmount('10');
                    }}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleApproveDelegate}
                    disabled={actionLoading || !approveAmount}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading ? 'Processing...' : 'Approve Delegate'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Deposit Modal */}
        {showDepositModal && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50" onClick={() => setShowDepositModal(false)}>
            <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white" onClick={(e) => e.stopPropagation()}>
              <div className="mt-3">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Deposit Funds</h3>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Amount (SOL)
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="0.0"
                  />
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => {
                      setShowDepositModal(false);
                      setDepositAmount('');
                    }}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeposit}
                    disabled={actionLoading || !depositAmount}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading ? 'Processing...' : 'Deposit'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Transfer Modal */}
        {showTransferModal && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50" onClick={closeTransferModal}>
            <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white" onClick={(e) => e.stopPropagation()}>
              <div className="mt-3">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Transfer Funds</h3>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Recipient Username or Address
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={transferRecipient}
                      onChange={handleRecipientChange}
                      className={`w-full px-3 py-2 pr-10 border ${
                        recipientLookupStatus === 'not_found' 
                          ? 'border-red-300 focus:ring-red-500 focus:border-red-500' 
                          : recipientLookupStatus === 'found'
                          ? 'border-green-300 focus:ring-green-500 focus:border-green-500'
                          : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'
                      } rounded-md shadow-sm focus:outline-none`}
                      placeholder="@alice or 0x..."
                    />
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                      {recipientLookupStatus === 'loading' && (
                        <svg className="animate-spin h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      )}
                      {recipientLookupStatus === 'found' && (
                        <svg className="h-5 w-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      )}
                      {recipientLookupStatus === 'not_found' && (
                        <svg className="h-5 w-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                  </div>
                  {recipientLookupStatus === 'found' && resolvedRecipientInfo && (
                    <p className="mt-1 text-sm text-green-600">
                      ✓ Found @{resolvedRecipientInfo.username}
                    </p>
                  )}
                  {recipientLookupStatus === 'not_found' && (
                    <p className="mt-1 text-sm text-red-600">
                      User not found. Please check the username or enter a public key.
                    </p>
                  )}
                  {!recipientLookupStatus && (
                    <p className="mt-1 text-xs text-gray-500">
                      Enter @username or full public key (0x...)
                    </p>
                  )}
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Amount (SOL)
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="0.0"
                  />
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    onClick={closeTransferModal}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleTransfer}
                    disabled={actionLoading || !transferAmount || !transferRecipient}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading ? 'Processing...' : 'Transfer'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Note Selection Modal for Withdraw */}
        {showNoteSelectionModal && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50" onClick={() => setShowNoteSelectionModal(false)}>
            <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white" onClick={(e) => e.stopPropagation()}>
              <div className="mt-3">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Select Note to Withdraw</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Select a note to withdraw. The full amount of the selected note will be withdrawn to your Solana wallet.
                </p>
                <div className="mb-4 max-h-96 overflow-y-auto">
                  {withdrawableNotes.length === 0 ? (
                    <p className="text-gray-500 text-center py-4">No withdrawable notes available</p>
                  ) : (
                    <div className="space-y-2">
                      {withdrawableNotes.map((note, index) => (
                        <button
                          key={index}
                          onClick={() => handleNoteSelect(note)}
                          disabled={actionLoading}
                          className="w-full text-left p-3 border border-gray-300 rounded-md hover:bg-gray-50 hover:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <div className="flex justify-between items-center">
                            <div>
                              <p className="text-sm font-medium text-gray-900">
                                {note.amountFormatted || (Number(note.amount) / 1e9).toFixed(9) + ' SOL'}
                              </p>
                              <p className="text-xs text-gray-500 mt-1">
                                Note #{index + 1}
                                {note.commitment && (
                                  <span className="ml-2">({note.commitment.slice(0, 8)}...)</span>
                                )}
                              </p>
                            </div>
                            <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => {
                      setShowNoteSelectionModal(false);
                      setWithdrawableNotes([]);
                    }}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Notes Details Modal */}
        {showNotesModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
              <div className="p-6 border-b border-gray-200">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {selectedNoteType === 'spendable' ? 'Spendable Notes' : 'All Notes'} Details
                  </h3>
                  <button
                    onClick={() => setShowNotesModal(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <p className="mt-2 text-sm text-gray-600">
                  {selectedNoteType === 'spendable' 
                    ? 'Notes available for transfers and withdrawals' 
                    : 'All notes including spent ones'}
                </p>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6">
                {(selectedNoteType === 'spendable' ? spendableNotes : allNotes).length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                    <p className="text-lg font-medium">No notes found</p>
                    <p className="text-sm mt-2">Deposit funds to create your first note</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {(selectedNoteType === 'spendable' ? spendableNotes : allNotes).map((note, index) => (
                      <div key={index} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center space-x-2">
                            <span className="text-sm font-medium text-gray-700">Note #{index + 1}</span>
                            {note.spent || note.isSpent ? (
                              <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded">
                                Spent
                              </span>
                            ) : (
                              <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded">
                                Spendable
                              </span>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="text-2xl font-bold text-gray-900">
                              {formatNoteAmount(note.amount)} SOL
                            </div>
                          </div>
                        </div>
                        
                        <div className="space-y-2 text-sm">
                          {note.commitment && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Commitment:</span>
                              <span className="text-gray-900 font-mono text-xs">
                                {note.commitment.slice(0, 10)}...{note.commitment.slice(-8)}
                              </span>
                            </div>
                          )}
                          {note.tokenId !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Token:</span>
                              <span className="text-gray-900">
                                {note.tokenId === 0 ? 'SOL (Native)' : `Token ${note.tokenId}`}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <div className="p-6 border-t border-gray-200 bg-gray-50">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">
                    Total: {(selectedNoteType === 'spendable' ? spendableNotes : allNotes).length} notes
                  </span>
                  <button
                    onClick={() => setShowNotesModal(false)}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Dashboard; 