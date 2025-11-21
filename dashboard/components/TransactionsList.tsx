'use client';

import { ScheduledTransaction } from '@/types';
import { Clock, CheckCircle, XCircle, Zap, FileText } from 'lucide-react';

interface TransactionsListProps {
  transactions: ScheduledTransaction[];
}

export default function TransactionsList({ transactions }: TransactionsListProps) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-5 h-5 text-yellow-500" />;
      case 'signed':
        return <CheckCircle className="w-5 h-5 text-blue-500" />;
      case 'executed':
        return <Zap className="w-5 h-5 text-green-500" />;
      case 'rejected':
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <FileText className="w-5 h-5 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string, sigCount: number) => {
    if (status === 'executed') {
      return 'bg-green-900/30 text-green-300';
    }
    if (status === 'rejected') {
      return 'bg-red-900/30 text-red-300';
    }
    // Pending with signatures
    if (sigCount > 0) {
      return 'bg-blue-900/30 text-blue-300';
    }
    // Pending without signatures
    return 'bg-yellow-900/30 text-yellow-300';
  };

  if (transactions.length === 0) {
    return (
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-12 text-center">
        <FileText className="w-16 h-16 text-gray-600 mx-auto mb-4" />
        <h3 className="text-xl font-semibold text-gray-400 mb-2">
          No Scheduled Transactions
        </h3>
        <p className="text-gray-500">
          Trigger test transactions to see them appear here
        </p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
      <div className="p-6 border-b border-gray-800">
        <h2 className="text-2xl font-bold text-white">
          Scheduled Transactions
        </h2>
        <p className="text-sm text-gray-400 mt-1">
          {transactions.length} transaction(s) found
        </p>
      </div>

      <div className="divide-y divide-gray-800">
        {transactions.map((tx) => (
          <div key={tx.schedule_id} className="p-6 hover:bg-gray-800/50 transition">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                {getStatusIcon(tx.status)}
                <div>
                  <code className="text-sm font-mono text-white">
                    {tx.schedule_id}
                  </code>
                  {tx.requiresMySignature && (
                    <span className="ml-3 inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-orange-900/30 text-orange-300">
                      Signature Required
                    </span>
                  )}
                  {tx.rejection && (
                    <span className="ml-3 inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-900/30 text-red-300 border border-red-700">
                      ⚠️ REJECTED BY AGENT
                    </span>
                  )}
                </div>
              </div>
              {(() => {
                // Count only legitimate threshold signatures
                const legitimateSigCount = tx.signatures.filter(sig => sig.isInThreshold).length;
                return (
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase ${getStatusColor(tx.status, legitimateSigCount)}`}>
                    {tx.status === 'pending' && legitimateSigCount > 0 ? `Pending (${legitimateSigCount} sig${legitimateSigCount > 1 ? 's' : ''})` : tx.status}
                  </span>
                );
              })()}
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-400">Creator:</span>
                <code className="ml-2 text-xs bg-gray-800 px-2 py-1 rounded">
                  {tx.creator_account_id}
                </code>
              </div>
              <div>
                <span className="text-gray-400">Payer:</span>
                <code className="ml-2 text-xs bg-gray-800 px-2 py-1 rounded">
                  {tx.payer_account_id}
                </code>
              </div>
            </div>

            {tx.rejection && (
              <div className="mt-3 pt-3 border-t border-red-900/50 bg-red-900/10 -mx-6 px-6 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 bg-red-600 rounded-full flex items-center justify-center text-white font-bold">
                    !
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-semibold text-red-300">Agent Rejection</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-semibold uppercase ${
                        tx.rejection.riskLevel === 'critical' ? 'bg-red-600 text-white' :
                        tx.rejection.riskLevel === 'high' ? 'bg-orange-600 text-white' :
                        'bg-yellow-600 text-white'
                      }`}>
                        {tx.rejection.riskLevel} Risk
                      </span>
                    </div>
                    {tx.rejection.functionName && (
                      <div className="text-xs text-gray-400 mb-1">
                        Function: <code className="bg-gray-800 px-1 py-0.5 rounded">{tx.rejection.functionName}</code>
                      </div>
                    )}
                    <p className="text-sm text-red-200 leading-relaxed">
                      {tx.rejection.reason}
                    </p>
                    <div className="text-xs text-gray-500 mt-2">
                      Rejected by: {tx.rejection.reviewer}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tx.signatures.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-800">
                <div className="text-sm text-gray-400 mb-2">
                  Signatures: {tx.signatures.length}
                </div>
                <div className="flex flex-wrap gap-2">
                  {tx.signatures.map((sig, idx) => {
                    // Determine styling based on whether signature is in threshold
                    const isLegitimate = sig.isInThreshold;
                    const baseStyle = isLegitimate
                      ? sig.isAgent
                        ? 'bg-purple-900/30 text-purple-300 border border-purple-700'
                        : 'bg-green-900/20 text-green-300'
                      : 'bg-gray-800 text-gray-400 border border-dashed border-gray-600';
                    
                    return (
                      <div
                        key={idx}
                        className={`text-xs px-2 py-1 rounded font-mono flex items-center gap-1 ${baseStyle}`}
                      >
                        {isLegitimate ? '✓' : '○'} {Buffer.from(sig.public_key_prefix, 'base64').toString('hex').slice(0, 16)}...
                        {sig.isAgent && isLegitimate && (
                          <span className="ml-1 text-[10px] font-semibold bg-purple-600 text-white px-1 rounded">
                            AGENT
                          </span>
                        )}
                        {!isLegitimate && (
                          <span className="ml-1 text-[10px] font-semibold bg-gray-500 text-white px-1 rounded">
                            NON-VOTING
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

