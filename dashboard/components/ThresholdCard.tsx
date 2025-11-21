'use client';

import { ThresholdInfo } from '@/types';
import { Key, Shield, Wallet } from 'lucide-react';

interface ThresholdCardProps {
  threshold: ThresholdInfo;
}

export default function ThresholdCard({ threshold }: ThresholdCardProps) {
  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
      <div className="flex items-center gap-3 mb-4">
        <Shield className="w-8 h-8 text-purple-500" />
        <div>
          <h2 className="text-2xl font-bold text-white">
            KeyRing Certified Account
          </h2>
          <code className="text-sm text-gray-400">
            {threshold.accountId}
          </code>
        </div>
      </div>

      {threshold.memo && (
        <p className="text-sm text-gray-400 mb-4">
          {threshold.memo}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-purple-900/20 rounded-lg p-4 border border-purple-800">
          <div className="text-sm text-gray-400 mb-1">
            Threshold
          </div>
          <div className="text-3xl font-bold text-purple-400">
            {threshold.threshold} / {threshold.totalKeys}
          </div>
        </div>
        <div className="bg-blue-900/20 rounded-lg p-4 border border-blue-800">
          <div className="text-sm text-gray-400 mb-1 flex items-center gap-1">
            <Wallet className="w-4 h-4" />
            Balance
          </div>
          <div className="text-2xl font-bold text-blue-400">
            {threshold.balance ? (parseFloat(threshold.balance) / 100000000).toFixed(2) : '0'} ℏ
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Key className="w-5 h-5 text-gray-500" />
          <h3 className="text-lg font-semibold text-white">
            KeyRing Validators ({threshold.totalKeys})
          </h3>
        </div>
        <div className="space-y-2">
          {threshold.keys.map((key, index) => {
            // Extract raw key bytes from DER format for comparison
            // DER format: 302a300506032b6570032100 (prefix) + 32 bytes (64 hex chars)
            const keyRaw = key.length > 64 ? key.slice(-64) : key;
            const agentRaw = threshold.agentPublicKey.length > 64 ? threshold.agentPublicKey.slice(-64) : threshold.agentPublicKey;
            const isAgent = keyRaw === agentRaw || key === threshold.agentPublicKey;
            
            return (
              <div
                key={index}
                className={`rounded p-3 font-mono text-xs break-all ${
                  isAgent 
                    ? 'bg-purple-900/20 border-2 border-purple-700' 
                    : 'bg-gray-800'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-gray-400">#{index + 1}</span>
                  {isAgent && (
                    <span className="px-2 py-0.5 text-xs font-semibold bg-purple-600 text-white rounded">
                      Validator Agent
                    </span>
                  )}
                </div>
                <span className="text-gray-100">{key}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

