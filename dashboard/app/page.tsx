'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, PlayCircle } from 'lucide-react';
import { toast } from 'sonner';
import ProjectCard from '@/components/ProjectCard';
import ThresholdCard from '@/components/ThresholdCard';
import TransactionsList from '@/components/TransactionsList';
import StatsCards from '@/components/StatsCards';
import type { ProjectInfo, ThresholdInfo, ScheduledTransaction, DashboardStats } from '@/types';
import * as api from '@/lib/api';

export default function DashboardPage() {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [threshold, setThreshold] = useState<ThresholdInfo | null>(null);
  const [transactions, setTransactions] = useState<ScheduledTransaction[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async (isInitial = false) => {
    if (isInitial) {
      setInitialLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);
    try {
      const [projectRes, thresholdRes, transactionsRes, statsRes, rejectionsRes] = await Promise.all([
        api.fetchProjectInfo(),
        api.fetchThresholdInfo(),
        api.fetchTransactions(),
        api.fetchStats(),
        api.fetchRejections(),
      ]);

      if (projectRes.success) setProject(projectRes.data);
      if (thresholdRes.success) setThreshold(thresholdRes.data);
      
      // Merge rejections with transactions
      if (transactionsRes.success && rejectionsRes.success) {
        const txWithRejections = transactionsRes.data.map((tx: ScheduledTransaction) => ({
          ...tx,
          rejection: rejectionsRes.data[tx.schedule_id] || undefined
        }));
        setTransactions(txWithRejections);
      } else if (transactionsRes.success) {
        setTransactions(transactionsRes.data);
      }
      
      if (statsRes.success) setStats(statsRes.data);

      if (!projectRes.success || !thresholdRes.success || !transactionsRes.success || !statsRes.success) {
        setError('Some data failed to load. Check configuration.');
      }
    } catch (err) {
      setError('Failed to load dashboard data. Check console for details.');
      console.error('Error loading data:', err);
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  };

  const handleTriggerTest = async () => {
    setTriggering(true);
    try {
      const result = await api.triggerTestTransactions();
      if (result.success) {
        toast.success('Test transactions initiated! Refresh in a few seconds to see them.');
      }
    } catch (err) {
      toast.error('Failed to trigger test transactions. Check console for details.');
      console.error('Error triggering test:', err);
    } finally {
      setTriggering(false);
    }
  };

  useEffect(() => {
    loadData(true); // Initial load with full-screen loading
    // Auto-refresh every 30 seconds (background refresh)
    const interval = setInterval(() => loadData(false), 30000);
    return () => clearInterval(interval);
  }, []);

  if (initialLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-black">
        <div className="text-center">
          <RefreshCw className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-xl text-gray-300">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Action Bar */}
      <div className="bg-gray-900 border-b border-gray-800">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">
              Monitor your KeyRing certified project and validators
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => loadData(false)}
                disabled={refreshing}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </button>
              <button
                onClick={handleTriggerTest}
                disabled={triggering}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition disabled:opacity-50"
              >
                <PlayCircle className="w-4 h-4" />
                {triggering ? 'Triggering...' : 'Test Transactions'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 bg-black">
        <div className="container mx-auto px-4 py-8">
          {error && (
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 mb-6">
              <p className="text-red-200">{error}</p>
            </div>
          )}

          {/* Stats */}
          {stats && (
            <div className="mb-8">
              <StatsCards stats={stats} />
            </div>
          )}

          {/* Project and Threshold Info */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {project && <ProjectCard project={project} />}
            {threshold && <ThresholdCard threshold={threshold} />}
          </div>

          {/* Transactions */}
          <TransactionsList transactions={transactions} />
        </div>
      </main>
    </>
  );
}

