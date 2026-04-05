import { useState, useEffect, useRef } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { parseUnits, formatUnits, maxUint256, parseAbi, decodeErrorResult } from 'viem';
import { TOKENS, CONTRACTS, ERC20_ABI, PAIR_V2_ABI, ROUTER_V2_ABI } from '../utils/contracts';
import { Settings, ArrowDownUp, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { useRecentTransactions } from '../context/RecentTransactionsContext';

const REVERT_ERROR_ABI = parseAbi(['error Error(string)']);
const V2_FEE_NUMERATOR = 997n;
const V2_FEE_DENOMINATOR = 1000n;

function formatCompactBalance(balance: bigint | undefined, decimals: number): string {
  if (balance === undefined) return '0.00';
  const value = Number(formatUnits(balance, decimals));
  if (!Number.isFinite(value)) return '0.00';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(2);
}

function getAmountOutV2(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountInWithFee = amountIn * V2_FEE_NUMERATOR;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * V2_FEE_DENOMINATOR + amountInWithFee;
  if (denominator === 0n) return 0n;
  return numerator / denominator;
}

function extractRevertHex(e: unknown): `0x${string}` | undefined {
  const stack: unknown[] = [e];
  const visited = new Set<unknown>();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === null || cur === undefined || typeof cur !== 'object') continue;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const data = (cur as { data?: unknown }).data;
    if (typeof data === 'string' && data.startsWith('0x') && data.length > 10) {
      return data as `0x${string}`;
    }
    const cause = (cur as { cause?: unknown }).cause;
    if (cause !== undefined) stack.push(cause);
  }
  return undefined;
}

function formatContractError(e: unknown): string {
  const parts: string[] = [];
  const hex = extractRevertHex(e);
  if (hex) {
    try {
      const decoded = decodeErrorResult({ abi: REVERT_ERROR_ABI, data: hex });
      if (decoded.errorName === 'Error' && decoded.args?.[0] != null) {
        parts.push(`Revert reason: ${String(decoded.args[0])}`);
      }
    } catch {
      // ignore decode errors
    }
  }

  let cur: unknown = e;
  for (let i = 0; i < 10 && cur; i++) {
    if (cur instanceof Error) {
      const ex = cur as Error & { shortMessage?: string; metaMessages?: string[] };
      if (ex.shortMessage) parts.push(ex.shortMessage);
      if (ex.message && ex.message !== ex.shortMessage) parts.push(ex.message);
      if (Array.isArray(ex.metaMessages)) parts.push(...ex.metaMessages.filter(Boolean));
      cur = ex.cause;
    } else if (typeof cur === 'object') {
      const o = cur as { shortMessage?: string; details?: string; metaMessages?: string[]; cause?: unknown };
      if (o.shortMessage) parts.push(o.shortMessage);
      if (o.details) parts.push(o.details);
      if (Array.isArray(o.metaMessages)) parts.push(...o.metaMessages.filter(Boolean));
      cur = o.cause;
    } else {
      break;
    }
  }

  const uniq = Array.from(new Set(parts.map((p) => p.trim()).filter(Boolean)));
  return uniq.length ? uniq.join(' · ') : 'Unknown error';
}

export function SwapInterface() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { addTransaction } = useRecentTransactions();
  const approveSymbolRef = useRef('');
  const [amountIn, setAmountIn] = useState('');
  const [amountOut, setAmountOut] = useState('');
  const [slippage, setSlippage] = useState(1);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFethToFt564, setIsFethToFt564] = useState(true);
  const [isPreparingSwap, setIsPreparingSwap] = useState(false);

  const tokenIn = isFethToFt564 ? TOKENS.fETH : TOKENS.FT564;
  const tokenOut = isFethToFt564 ? TOKENS.FT564 : TOKENS.fETH;
  const parsedAmountIn = amountIn ? parseUnits(amountIn, tokenIn.decimals) : 0n;

  const { data: balanceIn, refetch: refetchBalanceIn } = useReadContract({
    address: tokenIn.address,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
    query: { enabled: !!address },
  });
  const { data: balanceOut, refetch: refetchBalanceOut } = useReadContract({
    address: tokenOut.address,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
    query: { enabled: !!address },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: tokenIn.address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [address as `0x${string}`, CONTRACTS.ROUTER_V2],
    query: { enabled: !!address },
  });
  const { data: pairToken0 } = useReadContract({
    address: CONTRACTS.PAIR_V2,
    abi: PAIR_V2_ABI,
    functionName: 'token0',
  });
  const { data: pairToken1 } = useReadContract({
    address: CONTRACTS.PAIR_V2,
    abi: PAIR_V2_ABI,
    functionName: 'token1',
  });
  const { data: reservesData, refetch: refetchReserves } = useReadContract({
    address: CONTRACTS.PAIR_V2,
    abi: PAIR_V2_ABI,
    functionName: 'getReserves',
  });

  useEffect(() => {
    if (!amountIn || parsedAmountIn <= 0n || !pairToken0 || !pairToken1 || !reservesData) {
      if (!amountIn) setAmountOut('');
      return;
    }

    const reserve0 = (reservesData as readonly [bigint, bigint, number])[0];
    const reserve1 = (reservesData as readonly [bigint, bigint, number])[1];
    const inIsToken0 = tokenIn.address.toLowerCase() === String(pairToken0).toLowerCase();
    const inIsToken1 = tokenIn.address.toLowerCase() === String(pairToken1).toLowerCase();

    if (!inIsToken0 && !inIsToken1) {
      setAmountOut('');
      return;
    }

    const reserveIn = inIsToken0 ? reserve0 : reserve1;
    const reserveOut = inIsToken0 ? reserve1 : reserve0;
    const quotedOut = getAmountOutV2(parsedAmountIn, reserveIn, reserveOut);
    setAmountOut(quotedOut > 0n ? formatUnits(quotedOut, tokenOut.decimals) : '');
  }, [amountIn, parsedAmountIn, pairToken0, pairToken1, reservesData, tokenIn.address, tokenOut.decimals]);

  const { writeContract: writeApprove, data: approveHash, isPending: isApproving } = useWriteContract();
  const { writeContractAsync: writeSwapAsync, isPending: isSwapping } = useWriteContract();
  const { isLoading: isWaitingApprove, isSuccess: isApproveSuccess, isError: isApproveError } =
    useWaitForTransactionReceipt({ hash: approveHash });

  useEffect(() => {
    if (!approveHash) return;
    addTransaction(`Approve ${approveSymbolRef.current || 'token'} for V2 router`, approveHash);
    toast.loading(
      <span>
        Approval submitted.{' '}
        <a href={`https://sepolia.etherscan.io/tx/${approveHash}`} target="_blank" rel="noreferrer" className="underline text-indigo-600 dark:text-indigo-400">
          Sepolia Etherscan
        </a>
      </span>,
      { id: 'approve-tx' },
    );
  }, [approveHash, addTransaction]);

  useEffect(() => {
    if (isApproveSuccess) {
      toast.success('Approval Confirmed!', { id: 'approve-tx' });
      refetchAllowance();
    } else if (isApproveError) {
      toast.error('Approval Failed.', { id: 'approve-tx' });
    }
  }, [isApproveSuccess, isApproveError, refetchAllowance]);

  const isInsufficientBalance = balanceIn !== undefined && parsedAmountIn > (balanceIn as bigint);
  const needsApproval = allowance !== undefined && (allowance as bigint) < parsedAmountIn;
  const isQuoting = !!amountIn && (!reservesData || !pairToken0 || !pairToken1);

  const handleMax = () => {
    if (balanceIn) setAmountIn(formatUnits(balanceIn as bigint, tokenIn.decimals));
  };

  const handleApprove = () => {
    approveSymbolRef.current = tokenIn.symbol;
    writeApprove({
      address: tokenIn.address,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [CONTRACTS.ROUTER_V2, maxUint256],
    } as any);
  };

  const handleSwap = async () => {
    if (!address || !publicClient || parsedAmountIn <= 0n || !reservesData || !pairToken0 || !pairToken1) return;

    setIsPreparingSwap(true);
    toast.loading('Submitting V2 swap…', { id: 'swap-tx' });

    try {
      const reserve0 = (reservesData as readonly [bigint, bigint, number])[0];
      const reserve1 = (reservesData as readonly [bigint, bigint, number])[1];
      const inIsToken0 = tokenIn.address.toLowerCase() === String(pairToken0).toLowerCase();
      const inIsToken1 = tokenIn.address.toLowerCase() === String(pairToken1).toLowerCase();

      if (!inIsToken0 && !inIsToken1) {
        throw new Error('Selected token pair does not match the configured UniswapV2 pair.');
      }

      const reserveIn = inIsToken0 ? reserve0 : reserve1;
      const reserveOut = inIsToken0 ? reserve1 : reserve0;
      const quotedOut = getAmountOutV2(parsedAmountIn, reserveIn, reserveOut);
      if (quotedOut <= 0n) throw new Error('Quote is zero. Pool reserves may be too low.');

      const slipBps = BigInt(Math.max(0, Math.min(10_000, Math.round(slippage * 100))));
      const amountOutMinimum = (quotedOut * (10_000n - slipBps)) / 10_000n;

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
      const swapHash = await writeSwapAsync({
        address: CONTRACTS.ROUTER_V2,
        abi: ROUTER_V2_ABI,
        functionName: 'swapExactTokensForTokens',
        args: [
          parsedAmountIn,
          amountOutMinimum,
          [tokenIn.address, tokenOut.address],
          address,
          deadline,
        ],
      } as any);
      addTransaction(`Swap ${amountIn} ${tokenIn.symbol} → ${tokenOut.symbol} (V2 router)`, swapHash);
      await publicClient.waitForTransactionReceipt({ hash: swapHash });

      toast.success(
        <span>
          Swap Confirmed.{' '}
          <a href={`https://sepolia.etherscan.io/tx/${swapHash}`} target="_blank" rel="noreferrer" className="underline text-indigo-600 dark:text-indigo-400">
            Sepolia Etherscan
          </a>
        </span>,
        { id: 'swap-tx' },
      );

      setAmountIn('');
      setAmountOut('');
      refetchBalanceIn();
      refetchBalanceOut();
      refetchReserves();
    } catch (e: unknown) {
      const msg = formatContractError(e);
      if (msg.toLowerCase().includes('user rejected')) {
        toast.error('Transaction rejected in wallet.', { id: 'swap-tx' });
      } else if (msg.toLowerCase().includes('insufficient')) {
        toast.error('Swap failed: insufficient liquidity or balance.', { id: 'swap-tx' });
      } else {
        toast.error(msg.length > 240 ? `${msg.slice(0, 240)}…` : msg, { id: 'swap-tx', duration: 9000 });
      }
    } finally {
      setIsPreparingSwap(false);
    }
  };

  const getButtonState = () => {
    if (!isConnected) return { text: 'Connect Wallet', disabled: true, action: () => {} };
    if (!amountIn || Number(amountIn) === 0) return { text: 'Enter Amount', disabled: true, action: () => {} };
    if (isInsufficientBalance) return { text: 'Insufficient Balance', disabled: true, action: () => {} };
    if (needsApproval) {
      return { text: `Approve ${tokenIn.symbol}`, disabled: isApproving || isWaitingApprove, action: handleApprove };
    }
    return {
      text: 'Swap',
      disabled: isPreparingSwap || isSwapping || isQuoting || !amountOut,
      action: handleSwap,
    };
  };

  const buttonState = getButtonState();

  return (
    <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 shadow-xl p-4 sm:p-6 max-w-md w-full mx-auto relative overflow-hidden">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Swap</h2>
        <button
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors text-gray-500 dark:text-gray-400"
        >
          <Settings size={20} />
        </button>
      </div>

      {isSettingsOpen && (
        <div className="absolute top-16 right-4 sm:right-6 left-4 sm:left-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-lg rounded-xl p-4 z-10 w-auto sm:w-64">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Slippage Tolerance</p>
          <div className="flex gap-2 mb-2">
            {[0.1, 0.5, 1].map((val) => (
              <button
                key={val}
                onClick={() => setSlippage(val)}
                className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  slippage === val
                    ? 'bg-indigo-600 dark:bg-indigo-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {val}%
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5">
            <input
              type="number"
              value={slippage}
              onChange={(e) => setSlippage(Number(e.target.value))}
              className="w-full bg-transparent text-sm font-medium text-gray-900 dark:text-gray-100 outline-none text-right"
              placeholder="Custom"
            />
            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">%</span>
          </div>
        </div>
      )}

      <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-3 sm:p-4 border border-gray-100 dark:border-gray-700 mb-2 hover:border-indigo-200 dark:hover:border-indigo-700 transition-colors">
        <div className="flex justify-between mb-2 gap-2 flex-wrap">
          <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">You pay</span>
          <span className="text-sm text-gray-500 dark:text-gray-400 font-medium truncate text-right">
            Balance: {formatCompactBalance(balanceIn as bigint | undefined, tokenIn.decimals)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 sm:gap-4 min-w-0">
          <input
            type="number"
            value={amountIn}
            onChange={(e) => setAmountIn(e.target.value)}
            placeholder="0"
            className="bg-transparent text-3xl sm:text-4xl font-semibold text-gray-900 dark:text-gray-100 outline-none w-full min-w-0 placeholder-gray-300 dark:placeholder-gray-600"
          />
          <div className="flex items-center gap-2 bg-white dark:bg-gray-800 px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 shadow-sm shrink-0">
            <span className="font-bold text-gray-900 dark:text-gray-100">{tokenIn.symbol}</span>
          </div>
        </div>
        <div className="mt-3">
          <button
            onClick={handleMax}
            className="text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 px-2 py-1 rounded-md transition-colors uppercase tracking-wider"
          >
            Max
          </button>
        </div>
      </div>

      <div className="flex justify-center -my-4 relative z-10">
        <button
          onClick={() => {
            setIsFethToFt564(!isFethToFt564);
            setAmountIn('');
            setAmountOut('');
          }}
          className="bg-white dark:bg-gray-900 border-4 border-white dark:border-gray-900 p-2 rounded-xl text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors shadow-sm"
        >
          <ArrowDownUp size={20} />
        </button>
      </div>

      <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-3 sm:p-4 border border-gray-100 dark:border-gray-700 mt-2 hover:border-indigo-200 dark:hover:border-indigo-700 transition-colors">
        <div className="flex justify-between mb-2 gap-2 flex-wrap">
          <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">You receive</span>
          <span className="text-sm text-gray-500 dark:text-gray-400 font-medium truncate text-right">
            Balance: {formatCompactBalance(balanceOut as bigint | undefined, tokenOut.decimals)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 sm:gap-4 min-w-0">
          <input
            type="text"
            value={isQuoting ? 'Fetching...' : amountOut}
            readOnly
            placeholder="0"
            className="bg-transparent text-3xl sm:text-4xl font-semibold text-gray-900 dark:text-gray-100 outline-none w-full min-w-0 placeholder-gray-300 dark:placeholder-gray-600"
          />
          <div className="flex items-center gap-2 bg-white dark:bg-gray-800 px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 shadow-sm shrink-0">
            <span className="font-bold text-gray-900 dark:text-gray-100">{tokenOut.symbol}</span>
          </div>
        </div>
      </div>

      {amountIn && amountOut && !isQuoting && (
        <div className="mt-4 px-2 py-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 flex flex-col gap-2">
          <div className="flex justify-between text-sm gap-2">
            <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1 shrink-0">
              Rate <Info size={14} />
            </span>
            <span className="font-medium text-gray-900 dark:text-gray-100 text-right break-all">
              1 {tokenIn.symbol} = {(Number(amountOut) / Number(amountIn)).toFixed(6)} {tokenOut.symbol}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Slippage Tolerance</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">{slippage}%</span>
          </div>
        </div>
      )}

      <button
        onClick={buttonState.action}
        disabled={buttonState.disabled}
        className={`w-full mt-6 py-4 rounded-2xl font-bold text-base sm:text-lg transition-all shadow-sm ${
          buttonState.disabled
            ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'
            : needsApproval
              ? 'bg-amber-500 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500 text-white shadow-amber-500/20'
              : 'bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white shadow-indigo-600/20'
        }`}
      >
        {buttonState.text}
      </button>
    </div>
  );
}
