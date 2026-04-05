import { WalletConnect } from './WalletConnect';
import { Activity, Sun, Moon } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

export function Header() {
  const { isDark, toggleTheme } = useTheme();

  return (
    <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-40">
      <div className="flex items-center gap-3 min-w-0">
        <div className="bg-indigo-600 dark:bg-indigo-500 p-2 rounded-xl text-white shadow-sm shrink-0">
          <Activity size={24} />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100 tracking-tight leading-none truncate">
            Duke FinTech564
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium tracking-wide mt-1 uppercase">
            Trading Platform
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3 shrink-0 ml-auto">
        <button
          type="button"
          onClick={toggleTheme}
          className="p-2 rounded-xl text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors border border-transparent hover:border-gray-200 dark:hover:border-gray-700"
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Sun size={20} strokeWidth={2} /> : <Moon size={20} strokeWidth={2} />}
        </button>
        <WalletConnect />
      </div>
    </header>
  );
}
