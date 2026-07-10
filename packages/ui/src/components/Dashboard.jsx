import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCipherPay } from '../contexts/CipherPayContext';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  LayoutDashboard, ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, FileStack,
  Radio, Cpu, KeyRound, ClipboardList, Bell, Lock, Settings as SettingsIcon, LifeBuoy,
  Wallet as WalletIcon, User, ShieldCheck, Copy, RefreshCw, LogOut, ExternalLink,
  Check, X, Info, Loader2, ArrowRight, AlertTriangle, ChevronDown, CheckCircle2,
} from 'lucide-react';
import SolanaStatus from './SolanaStatus';
import SDKStatus from './SDKStatus';
import MessageModal from './MessageModal';
import authService from '../services/authService';
import { decryptFromSenderForMe } from '../lib/e2ee';
import { parseFriendlyErrorMessage } from '../utils/errorMessages';

const INFO_MODAL_ICONS = { info: Info, success: CheckCircle2, error: AlertTriangle };

function Dashboard() {
  const navigate = useNavigate();
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
    destroyAta,
    approveRelayerDelegate,
    checkRelayerDelegateApproved,
    createTransfer,
    getWithdrawableNotes,
    createWithdraw,
    clearError
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
  const [walletBalanceError, setWalletBalanceError] = useState(null);
  const [copiedItem, setCopiedItem] = useState(null); // Track what was copied for feedback
  const [ataBalance, setAtaBalance] = useState(0);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [showDestroyAtaModal, setShowDestroyAtaModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorModalContent, setErrorModalContent] = useState({ title: '', message: '' });
  const [infoModal, setInfoModal] = useState(null); // { title, message, tone }
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
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
  const overviewRef = useRef(null);
  const solanaStatusRef = useRef(null);
  const sdkStatusRef = useRef(null);

  const scrollToRef = (ref) => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const auditPortalHref = useMemo(() => {
    const base =
      import.meta.env.VITE_ZKAUDIT_URL?.trim() ||
      "https://zkaudit.appfounder.ca";
    const clean = base.replace(/\/$/, "");
    try {
      const token = localStorage.getItem("cipherpay_token");
      if (token) {
        return `${clean}/user/activities#cp_token=${encodeURIComponent(token)}`;
      }
    } catch {
      /* ignore */
    }
    return `${clean}/user/activities`;
  }, [isAuthenticated, authUser]);

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

  // Check on-chain if relayer delegate is already approved (so we don't prompt every login).
  // Do NOT assume approved just because the user has existing notes (e.g. from before a relayer
  // key rotation) - that previously raced with this check and could hide the approval banner
  // while the on-chain delegate was actually stale, letting deposits fail server-side instead.
  useEffect(() => {
    const check = async () => {
      if (!wallet.publicKey || !checkRelayerDelegateApproved) return;
      try {
        const approved = await checkRelayerDelegateApproved({
          walletPublicKey: wallet.publicKey.toBase58(),
        });
        setIsDelegateApproved(approved);
      } catch (err) {
        console.warn('[Dashboard] checkRelayerDelegateApproved:', err?.message);
      }
    };
    check();
    // checkRelayerDelegateApproved is a plain (non-memoized) function from CipherPayContext that
    // gets a new reference on every provider render; including it here would re-run this on-chain
    // check (and its RPC calls) on nearly every render instead of only when the wallet changes.
  }, [wallet.publicKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch wallet balance and ATA balance via the backend, not a direct browser connection
  // to the validator — browsers in this environment cannot reliably hold a direct connection
  // to the local validator (requests stall indefinitely in the browser's own socket pool),
  // while the backend reaches it instantly. See packages/server/src/routes/wallet.balance.get.ts.
  const fetchBalancesInFlightRef = useRef(false);
  useEffect(() => {
    const fetchBalances = async () => {
      if (!wallet.publicKey) {
        setWalletBalance(0);
        setAtaBalance(0);
        setWalletBalanceError(null);
        return;
      }
      if (fetchBalancesInFlightRef.current) return;
      fetchBalancesInFlightRef.current = true;

      try {
        const res = await fetch(`/api/wallet/balance?pubkey=${wallet.publicKey.toBase58()}`);
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Failed to fetch balance');
        setWalletBalance(json.walletBalance);
        setAtaBalance(json.ataBalance);
        setWalletBalanceError(null);
      } catch (err) {
        console.error('[Dashboard] Failed to fetch wallet balance:', err);
        setWalletBalanceError(err?.message || 'Failed to fetch balance');
      } finally {
        fetchBalancesInFlightRef.current = false;
      }
    };

    fetchBalances();

    // Refresh balances periodically (every 5 seconds)
    const interval = setInterval(fetchBalances, 5000);
    return () => clearInterval(interval);
  }, [wallet.publicKey]);

  const showInfoModal = (title, message, tone = 'info') => setInfoModal({ title, message, tone });

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
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-green-500/15 text-green-400">
            <ArrowDownToLine className="h-5 w-5" />
          </div>
        );
      case 'TransferCompleted':
        return (
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-400">
            <ArrowLeftRight className="h-5 w-5" />
          </div>
        );
      case 'WithdrawCompleted':
        return (
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-orange-500/15 text-orange-400">
            <ArrowUpFromLine className="h-5 w-5" />
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
      showInfoModal('Invalid amount', 'Please enter a valid approval amount.');
      return;
    }
    try {
      setActionLoading(true);
      const amountInLamports = BigInt(Math.floor(parseFloat(approveAmount) * 1e9));
      
      const approvalParams = {
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
      
      showInfoModal('Delegate approved', `You can now make deposits. Transaction: ${result?.signature || 'success'}`, 'success');
    } catch (err) {
      console.error('[Dashboard] Failed to approve delegate:', err);
      clearError();
      setErrorModalContent({
        title: 'Approval Failed',
        message: parseFriendlyErrorMessage(err?.message || 'Unknown error')
      });
      setShowErrorModal(true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) {
      showInfoModal('Invalid amount', 'Please enter a valid deposit amount.');
      return;
    }

    // Check if delegate approval is needed
    if (!isDelegateApproved) {
      setShowApproveConfirm(true);
      return;
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
      
      showInfoModal('Deposit successful', `Transaction: ${result?.txHash || result?.signature || 'pending'}`, 'success');
    } catch (err) {
      console.error('[Dashboard] Failed to deposit:', err);
      clearError();
      setErrorModalContent({
        title: 'Deposit Failed',
        message: parseFriendlyErrorMessage(err?.message || 'Unknown error')
      });
      setShowErrorModal(true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmApproveNow = () => {
    setShowApproveConfirm(false);
    setShowDepositModal(false);
    setShowApproveModal(true);
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
      showInfoModal('Invalid amount', 'Please enter a valid transfer amount.');
      return;
    }
    if (!transferRecipient || transferRecipient.trim() === '') {
      showInfoModal('Recipient required', 'Please enter a recipient address or username.');
      return;
    }

    // If username lookup is still in progress, wait
    if (recipientLookupStatus === 'loading') {
      showInfoModal('Please wait', "We're still looking up that username.");
      return;
    }

    // If username was not found
    if (recipientLookupStatus === 'not_found') {
      showInfoModal('User not found', 'Please check the username or enter a valid public key.');
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
      showInfoModal('Transfer successful', `Sent to ${recipientDisplay}. Transaction: ${txHash}`, 'success');
    } catch (err) {
      console.error('Failed to transfer:', err);
      clearError();
      setErrorModalContent({
        title: 'Transfer Failed',
        message: parseFriendlyErrorMessage(err?.message || 'Unknown error')
      });
      setShowErrorModal(true);
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
        showInfoModal('No notes available', 'Please deposit funds first.');
        return;
      }

      // Use connected wallet address as recipient
      const recipientAddress = publicAddress;
      if (!recipientAddress) {
        showInfoModal('Wallet required', 'Please connect your wallet first.');
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
      clearError();
      setErrorModalContent({
        title: 'Error',
        message: parseFriendlyErrorMessage(err?.message || 'Failed to load notes')
      });
      setShowErrorModal(true);
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
      showInfoModal(
        'Withdraw successful',
        `Amount: ${note.amountFormatted || (Number(note.amount) / 1e9).toFixed(9) + ' SOL'}\nTransaction: ${result.txHash || result.signature || 'pending'}`,
        'success'
      );
    } catch (err) {
      console.error('Failed to withdraw:', err);
      clearError();
      setErrorModalContent({
        title: 'Withdraw Failed',
        message: parseFriendlyErrorMessage(err?.message || 'Unknown error')
      });
      setShowErrorModal(true);
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
      showInfoModal('Wallet required', 'Please connect your wallet first.');
      return;
    }

    // Execute withdraw with selected note
    executeWithdraw(note, recipientAddress);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#05070f]">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white">Loading Dashboard...</h2>
        </div>
      </div>
    );
  }

  // Don't render dashboard content if not authenticated
  // This prevents flash of content before redirect
  if (!isInitialized || !isConnected || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#05070f]">
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-blue-500" />
          <p className="text-lg text-gray-400">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  const sidebarSections = [
    {
      items: [
        { icon: LayoutDashboard, label: 'Overview', onClick: () => scrollToRef(overviewRef), active: true },
      ],
    },
    {
      title: 'Transactions',
      items: [
        { icon: ArrowDownToLine, label: 'Deposit', onClick: () => setShowDepositModal(true) },
        { icon: ArrowLeftRight, label: 'Transfer', onClick: () => setShowTransferModal(true) },
        { icon: ArrowUpFromLine, label: 'Withdraw', onClick: handleWithdrawClick },
        { icon: FileStack, label: 'Notes', onClick: () => handleShowNotes('all') },
      ],
    },
    {
      title: 'Integration',
      items: [
        { icon: Radio, label: 'Relayer Status', onClick: () => scrollToRef(solanaStatusRef) },
        { icon: Cpu, label: 'SDK Components', onClick: () => scrollToRef(sdkStatusRef) },
        { icon: KeyRound, label: 'API Keys', placeholder: true },
      ],
    },
    {
      title: 'Audit & Security',
      items: [
        { icon: ClipboardList, label: 'Audit Logs', href: auditPortalHref, external: true },
        { icon: Bell, label: 'Alerts', placeholder: true },
        { icon: Lock, label: 'Security', placeholder: true },
      ],
    },
    {
      title: 'Settings',
      items: [
        { icon: SettingsIcon, label: 'Settings', placeholder: true },
        { icon: LifeBuoy, label: 'Support', placeholder: true },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-[#05070f] text-white">
      <div className="flex">
        {/* Sidebar */}
        <aside className="flex w-64 flex-shrink-0 flex-col justify-between border-r border-white/10 p-4">
          <div>
            <div className="mb-6 flex items-center gap-2 px-2 py-2">
              <img src="/images/Header-Footer-logo.png" alt="CipherPay" className="h-7 w-auto" />
            </div>
            <nav className="space-y-6">
              {sidebarSections.map((section, sectionIndex) => (
                <div key={sectionIndex}>
                  {section.title && (
                    <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                      {section.title}
                    </p>
                  )}
                  <div className="space-y-1">
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      const className = `flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        item.active ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-white'
                      }`;
                      if (item.href) {
                        return (
                          <a
                            key={item.label}
                            href={item.href}
                            target={item.external ? '_blank' : undefined}
                            rel={item.external ? 'noopener noreferrer' : undefined}
                            className={className}
                          >
                            <Icon className="h-4 w-4" />
                            {item.label}
                          </a>
                        );
                      }
                      return (
                        <button
                          key={item.label}
                          type="button"
                          onClick={item.onClick}
                          title={item.placeholder ? 'Coming soon' : undefined}
                          className={className}
                        >
                          <Icon className="h-4 w-4" />
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </div>

          <div className="rounded-xl border border-white/10 bg-gradient-to-b from-blue-500/10 to-purple-500/10 p-4 text-center">
            <img src="/images/dashboard-shield.png" alt="" className="mx-auto mb-3 h-16 w-16" />
            <p className="text-sm font-semibold text-white">Privacy by design. Trust by proof.</p>
            <p className="mt-1 text-xs text-gray-400">Zero-knowledge privacy for Solana payments.</p>
            <a
              href="#"
              className="mt-3 flex items-center justify-center gap-1 rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 py-2 text-xs font-semibold text-white hover:opacity-90"
            >
              Learn More <ArrowRight className="h-3 w-3" />
            </a>
          </div>
        </aside>

        {/* Main column */}
        <div className="min-w-0 flex-1">
          {/* Top bar */}
          <header className="flex items-center justify-between border-b border-white/10 px-8 py-5">
            <div>
              <h1 className="text-2xl font-bold text-white">Dashboard</h1>
              {authUser?.username && (
                <button
                  onClick={() => handleCopy(authUser.username, 'username')}
                  className="group mt-1 flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200"
                  title="Click to copy username"
                >
                  <span>Welcome back, @{authUser.username}</span>
                  {copiedItem === 'username' ? (
                    <Check className="h-3 w-3 text-green-400" />
                  ) : (
                    <Copy className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-50" />
                  )}
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <a
                href={auditPortalHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm text-gray-200 transition-colors hover:border-white/30"
              >
                <ExternalLink className="h-4 w-4" />
                Audit Portal
              </a>
              <button
                onClick={() => handleCopy(publicAddress, 'address')}
                className="flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 font-mono text-sm text-gray-200 transition-colors hover:border-white/30"
                title="Click to copy full address"
              >
                {formatAddress(publicAddress)}
                {copiedItem === 'address' ? (
                  <Check className="h-4 w-4 text-green-400" />
                ) : (
                  <Copy className="h-4 w-4 opacity-50" />
                )}
              </button>
              <button
                onClick={() => fetchRecentActivities(currentPage)}
                title="Refresh"
                className="rounded-lg border border-white/15 p-2.5 text-gray-200 transition-colors hover:border-white/30"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                <LogOut className="h-4 w-4" />
                Disconnect
              </button>
            </div>
          </header>

          {/* Main Content */}
          <div className="px-8 py-6">
            {error && (
              <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                <h3 className="text-sm font-medium text-red-300">Error</h3>
                <p className="mt-2 text-sm text-red-400">{error}</p>
              </div>
            )}

            {/* Account Overview */}
            <div ref={overviewRef} className="mb-6 scroll-mt-6">
              <h2 className="mb-4 text-lg font-semibold text-white">Account Overview</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-xl border border-white/10 bg-[#0d1220] p-5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-sm text-gray-400">
                      Wallet Balance
                      {walletBalanceError && (
                        <AlertTriangle
                          className="h-3.5 w-3.5 text-yellow-400"
                          title={`Couldn't refresh balance: ${walletBalanceError}`}
                        />
                      )}
                    </span>
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/15 text-blue-400">
                      <WalletIcon className="h-4 w-4" />
                    </div>
                  </div>
                  <p className="mt-3 text-2xl font-semibold text-white">{formatBalance(walletBalance)} SOL</p>
                  {walletBalanceError && (
                    <p className="mt-1 text-xs text-yellow-500">Showing last known value — refresh failed</p>
                  )}
                </div>

                <div className="rounded-xl border border-white/10 bg-[#0d1220] p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">User ATA Balance</span>
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/15 text-purple-400">
                      <User className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-3 flex items-end justify-between">
                    <p className="text-2xl font-semibold text-white">{formatBalance(ataBalance)} SOL</p>
                    {ataBalance > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowDestroyAtaModal(true)}
                        className="rounded-md bg-amber-500/15 px-2 py-1 text-xs text-amber-400 transition-colors hover:bg-amber-500/25"
                      >
                        Destroy ATA
                      </button>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-[#0d1220] p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">Shielded Balance</span>
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/15 text-green-400">
                      <ShieldCheck className="h-4 w-4" />
                    </div>
                  </div>
                  <p className="mt-3 text-2xl font-semibold text-white">{formatBalance(balance)} SOL</p>
                </div>

                <div
                  className="cursor-pointer rounded-xl border border-white/10 bg-[#0d1220] p-5 transition-colors hover:border-white/20"
                  onClick={() => handleShowNotes('spendable')}
                  title="Click to view spendable notes details"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-sm text-gray-400">
                      Spendable Notes
                      <Info className="h-3.5 w-3.5 text-gray-500" />
                    </span>
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
                      <FileStack className="h-4 w-4" />
                    </div>
                  </div>
                  <p className="mt-3 text-2xl font-semibold text-white">{spendableNotes.length}</p>
                </div>

                <div
                  className="cursor-pointer rounded-xl border border-white/10 bg-[#0d1220] p-5 transition-colors hover:border-white/20"
                  onClick={() => handleShowNotes('all')}
                  title="Click to view all notes details"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-sm text-gray-400">
                      Total Notes
                      <Info className="h-3.5 w-3.5 text-gray-500" />
                    </span>
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink-500/15 text-pink-400">
                      <FileStack className="h-4 w-4" />
                    </div>
                  </div>
                  <p className="mt-3 text-2xl font-semibold text-white">{allNotes.length}</p>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="mb-6">
              <h2 className="mb-4 text-lg font-semibold text-white">Quick Actions</h2>

              {!isDelegateApproved && (
                <div className="mb-4 flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
                  <AlertTriangle className="h-5 w-5 flex-shrink-0 text-yellow-400" />
                  <p className="text-sm text-yellow-200">
                    Before making your first deposit, you need to approve the relayer as a delegate for your tokens.
                    <button
                      onClick={() => setShowApproveModal(true)}
                      className="ml-2 font-medium text-yellow-300 underline hover:text-yellow-200"
                    >
                      Approve Now
                    </button>
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <button
                  onClick={() => setShowDepositModal(true)}
                  disabled={actionLoading}
                  className="group relative rounded-xl border border-white/10 bg-gradient-to-br from-green-500/10 to-transparent p-6 text-left transition-colors hover:border-green-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-green-500/15 text-green-400">
                      <ArrowDownToLine className="h-5 w-5" />
                    </div>
                    <ArrowRight className="h-5 w-5 text-gray-500 transition-transform group-hover:translate-x-1 group-hover:text-green-400" />
                  </div>
                  <h3 className="mt-4 font-semibold text-white">Deposit</h3>
                  <p className="mt-1 text-sm text-gray-400">Deposit funds into your shielded account</p>
                </button>

                <button
                  onClick={() => setShowTransferModal(true)}
                  disabled={actionLoading}
                  className="group relative rounded-xl border border-white/10 bg-gradient-to-br from-blue-500/10 to-transparent p-6 text-left transition-colors hover:border-blue-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400">
                      <ArrowLeftRight className="h-5 w-5" />
                    </div>
                    <ArrowRight className="h-5 w-5 text-gray-500 transition-transform group-hover:translate-x-1 group-hover:text-blue-400" />
                  </div>
                  <h3 className="mt-4 font-semibold text-white">Transfer</h3>
                  <p className="mt-1 text-sm text-gray-400">Transfer funds to another shielded account</p>
                </button>

                <button
                  onClick={handleWithdrawClick}
                  disabled={actionLoading}
                  className="group relative rounded-xl border border-white/10 bg-gradient-to-br from-purple-500/10 to-transparent p-6 text-left transition-colors hover:border-purple-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-purple-500/15 text-purple-400">
                      <ArrowUpFromLine className="h-5 w-5" />
                    </div>
                    <ArrowRight className="h-5 w-5 text-gray-500 transition-transform group-hover:translate-x-1 group-hover:text-purple-400" />
                  </div>
                  <h3 className="mt-4 font-semibold text-white">Withdraw</h3>
                  <p className="mt-1 text-sm text-gray-400">Withdraw funds from your shielded account</p>
                </button>
              </div>
            </div>

            {/* Activities + Status */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Recent Activities */}
              <div className="rounded-xl border border-white/10 bg-[#0d1220] p-6 lg:col-span-2">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">Recent Activities</h2>
                  <div className="flex items-center gap-3">
                    <label htmlFor="activitiesPerPage" className="text-sm text-gray-400">
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
                      className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-sm text-gray-200 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    >
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                    <button
                      onClick={() => fetchRecentActivities(currentPage)}
                      className="flex items-center text-sm text-blue-400 hover:text-blue-300"
                      title="Refresh activities"
                    >
                      <RefreshCw className="mr-1 h-4 w-4" />
                      Refresh
                    </button>
                  </div>
                </div>

                {/* Search Filters */}
                <div className="mb-4 border-b border-white/10 pb-4">
                  <div className="mb-2 flex items-center justify-between">
                    <button
                      onClick={() => setShowSearchFilters(!showSearchFilters)}
                      className="flex items-center text-sm text-blue-400 hover:text-blue-300"
                    >
                      <ChevronDown className={`mr-1 h-4 w-4 transition-transform ${showSearchFilters ? 'rotate-180' : ''}`} />
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
                        className="text-sm text-red-400 hover:text-red-300"
                      >
                        Clear All
                      </button>
                    )}
                  </div>

                  {showSearchFilters && (
                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                      <div>
                        <label htmlFor="searchUsername" className="mb-1 block text-sm font-medium text-gray-400">
                          Username
                        </label>
                        <input
                          type="text"
                          id="searchUsername"
                          value={searchUsername}
                          onChange={(e) => setSearchUsername(e.target.value)}
                          placeholder="@username"
                          className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        />
                      </div>

                      <div>
                        <label htmlFor="searchKind" className="mb-1 block text-sm font-medium text-gray-400">
                          Type
                        </label>
                        <select
                          id="searchKind"
                          value={searchKind}
                          onChange={(e) => setSearchKind(e.target.value)}
                          className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        >
                          <option value="">All Types</option>
                          <option value="deposit">Deposit</option>
                          <option value="transfer">Transfer</option>
                          <option value="withdraw">Withdraw</option>
                        </select>
                      </div>

                      <div>
                        <label htmlFor="searchDateFrom" className="mb-1 block text-sm font-medium text-gray-400">
                          Date From
                        </label>
                        <input
                          type="date"
                          id="searchDateFrom"
                          value={searchDateFrom}
                          onChange={(e) => setSearchDateFrom(e.target.value)}
                          className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        />
                      </div>

                      <div>
                        <label htmlFor="searchDateTo" className="mb-1 block text-sm font-medium text-gray-400">
                          Date To
                        </label>
                        <input
                          type="date"
                          id="searchDateTo"
                          value={searchDateTo}
                          onChange={(e) => setSearchDateTo(e.target.value)}
                          className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        />
                      </div>

                      <div>
                        <label htmlFor="searchAmountMin" className="mb-1 block text-sm font-medium text-gray-400">
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
                          className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        />
                      </div>

                      <div>
                        <label htmlFor="searchAmountMax" className="mb-1 block text-sm font-medium text-gray-400">
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
                          className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        />
                      </div>

                      <div>
                        <label htmlFor="searchSignature" className="mb-1 block text-sm font-medium text-gray-400">
                          Transaction Signature
                        </label>
                        <input
                          type="text"
                          id="searchSignature"
                          value={searchSignature}
                          onChange={(e) => setSearchSignature(e.target.value)}
                          placeholder="Enter signature"
                          className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
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
                        className="rounded-md bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                      >
                        Apply Filters
                      </button>
                    </div>
                  )}
                </div>

                {recentActivities.length === 0 ? (
                  <div className="py-8 text-center text-gray-500">
                    <FileStack className="mx-auto mb-4 h-16 w-16 text-gray-700" />
                    <p className="text-sm">No recent activity</p>
                    <p className="mt-1 text-xs text-gray-600">Your transactions will appear here</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recentActivities.map((activity, index) => (
                      <div key={activity.id || index} className="flex items-center justify-between rounded-lg bg-white/5 p-4 transition-colors hover:bg-white/10">
                        <div className="flex items-center gap-4">
                          {getActivityIcon(activity.event)}
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-white">
                                {getActivityType(activity)}
                              </p>
                              {getActivityDirection(activity) && (
                                <span className="text-xs text-gray-500">
                                  {getActivityDirection(activity)}
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-gray-500">
                              {formatTimestamp(activity.timestamp)}
                            </p>
                            {formatRecipient(activity) && (
                              <p className="mt-0.5 font-mono text-xs text-gray-600">
                                {formatRecipient(activity)}
                              </p>
                            )}
                            {activity.signature && (
                              <a
                                href={`https://explorer.solana.com/tx/${activity.signature}?cluster=custom&customUrl=http://127.0.0.1:8899`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-xs text-blue-400 hover:text-blue-300"
                              >
                                {activity.signature.slice(0, 8)}...
                              </a>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-sm font-semibold ${
                            (getActivityDirection(activity) === 'Received' || getActivityType(activity) === 'Change')
                              ? 'text-green-400'
                              : getActivityDirection(activity) === 'Sent'
                              ? 'text-red-400'
                              : 'text-white'
                          }`}>
                            {getActivityDirection(activity) === 'Sent' ? '-' :
                             (getActivityDirection(activity) === 'Received' || getActivityType(activity) === 'Change') ? '+' : ''}
                            {activity.amount !== null && activity.amount !== undefined
                              ? activity.amount.toFixed(4)
                              : (getActivityDirection(activity) === 'Sent' ? 'Sent' : '?')}
                            {(activity.amount !== null && activity.amount !== undefined) && (
                              <span className="ml-1 text-xs text-gray-500">SOL</span>
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
                    <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4">
                      <div className="flex items-center space-x-2">
                        {Array.from({ length: Math.ceil(totalActivities / activitiesPerPage) }, (_, i) => i + 1)
                          .filter(page => {
                            const totalPages = Math.ceil(totalActivities / activitiesPerPage);
                            if (totalPages <= 7) return true;
                            if (page === 1 || page === totalPages) return true;
                            if (Math.abs(page - currentPage) <= 1) return true;
                            return false;
                          })
                          .map((page, index, array) => {
                            const prevPage = array[index - 1];
                            const showEllipsisBefore = prevPage && page - prevPage > 1;

                            return (
                              <div key={page} className="flex items-center">
                                {showEllipsisBefore && (
                                  <span className="px-2 text-gray-500">...</span>
                                )}
                                <button
                                  onClick={() => fetchRecentActivities(page)}
                                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                                    currentPage === page
                                      ? 'bg-blue-600 text-white'
                                      : 'border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'
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
                        className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-lg font-medium text-gray-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                        title="First page"
                      >
                        &laquo;
                      </button>
                      <button
                        onClick={() => fetchRecentActivities(currentPage - 1)}
                        disabled={currentPage === 1}
                        className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-lg font-medium text-gray-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                        title="Previous page"
                      >
                        &lsaquo;
                      </button>
                      <button
                        onClick={() => fetchRecentActivities(currentPage + 1)}
                        disabled={currentPage >= Math.ceil(totalActivities / activitiesPerPage)}
                        className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-lg font-medium text-gray-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                        title="Next page"
                      >
                        &rsaquo;
                      </button>
                      <button
                        onClick={() => fetchRecentActivities(Math.ceil(totalActivities / activitiesPerPage))}
                        disabled={currentPage >= Math.ceil(totalActivities / activitiesPerPage)}
                        className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-lg font-medium text-gray-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                        title="Last page"
                      >
                        &raquo;
                      </button>
                    </div>
                  </>
                )}

                {/* Page info */}
                {totalActivities > 0 && (
                  <div className="mt-2 text-center text-xs text-gray-500">
                    Showing {((currentPage - 1) * activitiesPerPage) + 1} to {Math.min(currentPage * activitiesPerPage, totalActivities)} of {totalActivities} activities
                  </div>
                )}
              </div>

              {/* Right column: Status cards */}
              <div className="space-y-6">
                <div ref={solanaStatusRef} className="scroll-mt-6">
                  <SolanaStatus />
                </div>
                <div ref={sdkStatusRef} className="scroll-mt-6">
                  <SDKStatus />
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <footer className="flex flex-col items-center justify-between gap-4 border-t border-white/10 px-8 py-6 text-sm text-gray-500 md:flex-row">
            <p>© {new Date().getFullYear()} CipherPay. All rights reserved.</p>
            <nav className="flex gap-6">
              {['Docs', 'Privacy', 'Terms', 'Support'].map((link) => (
                <a key={link} href="#" className="hover:text-gray-300">
                  {link}
                </a>
              ))}
            </nav>
          </footer>
        </div>
      </div>

      {/* Approve Delegate Modal */}
      {showApproveModal && (
        <div className="fixed inset-0 z-50 h-full w-full overflow-y-auto bg-black/60" onClick={() => setShowApproveModal(false)}>
          <div className="relative top-20 mx-auto w-96 rounded-xl border border-white/10 bg-[#0d1220] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-medium text-white">Approve Relayer Delegate</h3>
            <p className="mb-4 text-sm text-gray-400">
              This is a one-time setup that allows the relayer to process deposits on your behalf.
              You're approving the relayer to spend up to the specified amount of tokens from your wallet.
            </p>
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Approval Amount (SOL)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={approveAmount}
                onChange={(e) => setApproveAmount(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
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
                className="rounded-md bg-white/10 px-4 py-2 text-gray-200 hover:bg-white/20"
              >
                Cancel
              </button>
              <button
                onClick={handleApproveDelegate}
                disabled={actionLoading || !approveAmount}
                className="rounded-md bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-2 text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionLoading ? 'Processing...' : 'Approve Delegate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Destroy ATA Confirmation Modal */}
      {showDestroyAtaModal && (
        <div className="fixed inset-0 z-50 h-full w-full overflow-y-auto bg-black/60" onClick={() => setShowDestroyAtaModal(false)}>
          <div className="relative top-20 mx-auto w-96 rounded-xl border border-white/10 bg-[#0d1220] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-medium text-white">Destroy ATA &amp; Reclaim SOL</h3>
            <p className="mb-4 text-sm text-gray-400">
              This will close your wSOL token account and move <strong className="text-gray-200">{formatBalance(ataBalance)} SOL</strong> to your wallet as native SOL. You will need to create a new ATA when you deposit again.
            </p>
            <p className="mb-4 text-sm text-amber-400">
              Are you sure you want to proceed?
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowDestroyAtaModal(false)}
                className="rounded-md bg-white/10 px-4 py-2 text-gray-200 hover:bg-white/20"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    setActionLoading(true);
                    await destroyAta();
                    setShowDestroyAtaModal(false);
                    clearError();
                    // Refresh balances (ATA is now closed, SOL moved to wallet)
                    setAtaBalance(0);
                    const res = await fetch(`/api/wallet/balance?pubkey=${wallet.publicKey.toBase58()}`);
                    const json = await res.json();
                    if (json.ok) setWalletBalance(json.walletBalance);
                    refreshData();
                  } catch (err) {
                    console.error('[Dashboard] destroyAta failed:', err);
                  } finally {
                    setActionLoading(false);
                  }
                }}
                disabled={actionLoading}
                className="rounded-md bg-amber-600 px-4 py-2 text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionLoading ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Modal - friendly display for action failures */}
      <MessageModal
        open={showErrorModal}
        onClose={() => { setShowErrorModal(false); setErrorModalContent({ title: '', message: '' }); }}
        tone="error"
        icon={AlertTriangle}
        title={errorModalContent.title}
        description={errorModalContent.message}
        primaryLabel="OK"
        onPrimary={() => { setShowErrorModal(false); setErrorModalContent({ title: '', message: '' }); }}
      />

      {/* Generic info/success modal - replaces browser alert() for validation & confirmations */}
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

      {/* Approve-relayer confirmation - replaces browser confirm() before first deposit */}
      <MessageModal
        open={showApproveConfirm}
        onClose={() => setShowApproveConfirm(false)}
        tone="info"
        icon={AlertTriangle}
        title="Approve relayer first"
        description="You need to approve the relayer as a delegate before making your first deposit. Would you like to approve now?"
        secondaryLabel="Cancel"
        onSecondary={() => setShowApproveConfirm(false)}
        primaryLabel="Approve Now"
        onPrimary={handleConfirmApproveNow}
      />

      {/* Deposit Modal */}
      {showDepositModal && (
        <div className="fixed inset-0 z-50 h-full w-full overflow-y-auto bg-black/60" onClick={() => setShowDepositModal(false)}>
          <div className="relative top-20 mx-auto w-96 rounded-xl border border-white/10 bg-[#0d1220] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-medium text-white">Deposit Funds</h3>
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Amount (SOL)
              </label>
              <input
                type="number"
                step="0.001"
                min="0"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/30"
                placeholder="0.0"
              />
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowDepositModal(false);
                  setDepositAmount('');
                }}
                className="rounded-md bg-white/10 px-4 py-2 text-gray-200 hover:bg-white/20"
              >
                Cancel
              </button>
              <button
                onClick={handleDeposit}
                disabled={actionLoading || !depositAmount}
                className="rounded-md bg-green-600 px-4 py-2 text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionLoading ? 'Processing...' : 'Deposit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Modal */}
      {showTransferModal && (
        <div className="fixed inset-0 z-50 h-full w-full overflow-y-auto bg-black/60" onClick={closeTransferModal}>
          <div className="relative top-20 mx-auto w-96 rounded-xl border border-white/10 bg-[#0d1220] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-medium text-white">Transfer Funds</h3>
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Recipient Username or Address
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={transferRecipient}
                  onChange={handleRecipientChange}
                  className={`w-full rounded-md border bg-white/5 px-3 py-2 pr-10 text-white focus:outline-none focus:ring-2 ${
                    recipientLookupStatus === 'not_found'
                      ? 'border-red-500/40 focus:border-red-500 focus:ring-red-500/30'
                      : recipientLookupStatus === 'found'
                      ? 'border-green-500/40 focus:border-green-500 focus:ring-green-500/30'
                      : 'border-white/10 focus:border-blue-500 focus:ring-blue-500/30'
                  }`}
                  placeholder="@alice or 0x..."
                />
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                  {recipientLookupStatus === 'loading' && <Loader2 className="h-5 w-5 animate-spin text-gray-500" />}
                  {recipientLookupStatus === 'found' && <Check className="h-5 w-5 text-green-400" />}
                  {recipientLookupStatus === 'not_found' && <X className="h-5 w-5 text-red-400" />}
                </div>
              </div>
              {recipientLookupStatus === 'found' && resolvedRecipientInfo && (
                <p className="mt-1 text-sm text-green-400">
                  ✓ Found @{resolvedRecipientInfo.username}
                </p>
              )}
              {recipientLookupStatus === 'not_found' && (
                <p className="mt-1 text-sm text-red-400">
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
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Amount (SOL)
              </label>
              <input
                type="number"
                step="0.001"
                min="0"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                placeholder="0.0"
              />
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={closeTransferModal}
                className="rounded-md bg-white/10 px-4 py-2 text-gray-200 hover:bg-white/20"
              >
                Cancel
              </button>
              <button
                onClick={handleTransfer}
                disabled={actionLoading || !transferAmount || !transferRecipient}
                className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionLoading ? 'Processing...' : 'Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Note Selection Modal for Withdraw */}
      {showNoteSelectionModal && (
        <div className="fixed inset-0 z-50 h-full w-full overflow-y-auto bg-black/60" onClick={() => setShowNoteSelectionModal(false)}>
          <div className="relative top-20 mx-auto w-96 rounded-xl border border-white/10 bg-[#0d1220] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-medium text-white">Select Note to Withdraw</h3>
            <p className="mb-4 text-sm text-gray-400">
              Select a note to withdraw. The full amount of the selected note will be withdrawn to your Solana wallet.
            </p>
            <div className="mb-4 max-h-96 overflow-y-auto">
              {withdrawableNotes.length === 0 ? (
                <p className="py-4 text-center text-gray-500">No withdrawable notes available</p>
              ) : (
                <div className="space-y-2">
                  {withdrawableNotes.map((note, index) => (
                    <button
                      key={index}
                      onClick={() => handleNoteSelect(note)}
                      disabled={actionLoading}
                      className="w-full rounded-md border border-white/10 bg-white/5 p-3 text-left transition-colors hover:border-blue-500/40 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-white">
                            {note.amountFormatted || (Number(note.amount) / 1e9).toFixed(9) + ' SOL'}
                          </p>
                          <p className="mt-1 text-xs text-gray-500">
                            Note #{index + 1}
                            {note.commitment && (
                              <span className="ml-2">({note.commitment.slice(0, 8)}...)</span>
                            )}
                          </p>
                        </div>
                        <ArrowRight className="h-5 w-5 text-blue-400" />
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
                className="rounded-md bg-white/10 px-4 py-2 text-gray-200 hover:bg-white/20"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notes Details Modal */}
      {showNotesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0d1220]">
            <div className="border-b border-white/10 p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">
                  {selectedNoteType === 'spendable' ? 'Spendable Notes' : 'All Notes'} Details
                </h3>
                <button
                  onClick={() => setShowNotesModal(false)}
                  className="text-gray-500 hover:text-gray-300"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
              <p className="mt-2 text-sm text-gray-400">
                {selectedNoteType === 'spendable'
                  ? 'Notes available for transfers and withdrawals'
                  : 'All notes including spent ones'}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {(selectedNoteType === 'spendable' ? spendableNotes : allNotes).length === 0 ? (
                <div className="py-8 text-center text-gray-500">
                  <FileStack className="mx-auto mb-4 h-16 w-16 text-gray-700" />
                  <p className="text-lg font-medium text-gray-300">No notes found</p>
                  <p className="mt-2 text-sm">Deposit funds to create your first note</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {(selectedNoteType === 'spendable' ? spendableNotes : allNotes).map((note, index) => (
                    <div key={index} className="rounded-lg border border-white/10 bg-white/5 p-4">
                      <div className="mb-3 flex items-start justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="text-sm font-medium text-gray-300">Note #{index + 1}</span>
                          {note.spent || note.isSpent ? (
                            <span className="rounded bg-red-500/15 px-2 py-1 text-xs font-medium text-red-400">
                              Spent
                            </span>
                          ) : (
                            <span className="rounded bg-green-500/15 px-2 py-1 text-xs font-medium text-green-400">
                              Spendable
                            </span>
                          )}
                        </div>
                        <div className="text-2xl font-bold text-white">
                          {formatNoteAmount(note.amount)} SOL
                        </div>
                      </div>

                      <div className="space-y-2 text-sm">
                        {note.commitment && (
                          <div className="flex justify-between">
                            <span className="text-gray-500">Commitment:</span>
                            <span className="font-mono text-xs text-gray-300">
                              {note.commitment.slice(0, 10)}...{note.commitment.slice(-8)}
                            </span>
                          </div>
                        )}
                        {note.tokenId !== undefined && (
                          <div className="flex justify-between">
                            <span className="text-gray-500">Token:</span>
                            <span className="text-gray-300">
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

            <div className="border-t border-white/10 bg-white/5 p-6">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">
                  Total: {(selectedNoteType === 'spendable' ? spendableNotes : allNotes).length} notes
                </span>
                <button
                  onClick={() => setShowNotesModal(false)}
                  className="rounded-md bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-2 text-white hover:opacity-90"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
