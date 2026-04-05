/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Header } from './components/Header';
import { MarketContext } from './components/MarketContext';
import { RecentTransactions } from './components/RecentTransactions';
import { SwapInterface } from './components/SwapInterface';
import { Leaderboard } from './components/Leaderboard';

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 font-sans selection:bg-indigo-100 dark:selection:bg-indigo-900/50 selection:text-indigo-900 dark:selection:text-indigo-100">
      <Header />
      
      <main className="max-w-[1600px] mx-auto p-4 sm:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
          
          {/* Left Panel: Market Context */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            <MarketContext />
          </div>

          {/* Middle Panel: recent txs + swap */}
          <div className="lg:col-span-4 flex flex-col gap-6 items-center">
            <div className="w-full max-w-md sticky top-20 sm:top-24 z-30">
              <SwapInterface />
            <RecentTransactions />
            </div>
          </div>

          {/* Right Panel: The Competition */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            <Leaderboard />
          </div>

        </div>
      </main>
    </div>
  );
}
