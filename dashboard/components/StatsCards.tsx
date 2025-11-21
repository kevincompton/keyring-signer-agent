'use client';

import { DashboardStats } from '@/types';
import { FileText, Clock, CheckCircle, XCircle } from 'lucide-react';

interface StatsCardsProps {
  stats: DashboardStats;
}

export default function StatsCards({ stats }: StatsCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-400 mb-1">Total Transactions</p>
            <p className="text-3xl font-bold text-white">
              {stats.totalScheduledTransactions}
            </p>
          </div>
          <FileText className="w-12 h-12 text-blue-500 opacity-80" />
        </div>
      </div>

      <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-400 mb-1">Pending Signatures</p>
            <p className="text-3xl font-bold text-yellow-400">
              {stats.pendingSignatures}
            </p>
          </div>
          <Clock className="w-12 h-12 text-yellow-500 opacity-80" />
        </div>
      </div>

      <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-400 mb-1">Signed</p>
            <p className="text-3xl font-bold text-green-400">
              {stats.signedTransactions}
            </p>
          </div>
          <CheckCircle className="w-12 h-12 text-green-500 opacity-80" />
        </div>
      </div>

      <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-400 mb-1">Rejected</p>
            <p className="text-3xl font-bold text-red-400">
              {stats.rejectedTransactions}
            </p>
          </div>
          <XCircle className="w-12 h-12 text-red-500 opacity-80" />
        </div>
      </div>
    </div>
  );
}

