import { useAccount, useConnect, useDisconnect, useSwitchChain, useBalance } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';
import { ChevronDown, LogOut, AlertTriangle } from 'lucide-react';
import { useState } from 'react';

export function WalletConnect() {
  const { address, isConnected, chain } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [isOpen, setIsOpen] = useState(false);

  const isWrongNetwork = isConnected && chain?.id !== sepolia.id;

  if (!isConnected) {
    return (
      <button
        onClick={() => connect({ connector: injected() })}
        className="bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white px-4 py-2 rounded-xl font-medium transition-colors shadow-sm text-sm sm:text-base"
      >
        Connect Wallet
      </button>
    );
  }

  if (isWrongNetwork) {
    return (
      <button
        onClick={() => switchChain({ chainId: sepolia.id })}
        className="bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-500 text-white px-3 sm:px-4 py-2 rounded-xl font-medium transition-colors shadow-sm flex items-center gap-2 text-sm sm:text-base"
      >
        <AlertTriangle size={18} />
        Switch to Sepolia
      </button>
    );
  }

  const truncatedAddress = `${address?.slice(0, 6)}...${address?.slice(-4)}`;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 sm:px-4 py-2 rounded-xl font-medium transition-colors shadow-sm max-w-[min(100%,16rem)]"
      >
        <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
        {truncatedAddress}
        <ChevronDown size={16} className="text-gray-500 dark:text-gray-400 shrink-0" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-100 dark:border-gray-800 overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider">Network</p>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mt-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
              Sepolia Testnet
            </p>
          </div>
          <button
            onClick={() => {
              disconnect();
              setIsOpen(false);
            }}
            className="w-full text-left px-4 py-3 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 font-medium flex items-center gap-2 transition-colors"
          >
            <LogOut size={16} />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
