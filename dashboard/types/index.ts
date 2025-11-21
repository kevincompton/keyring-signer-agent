/**
 * TypeScript types for the dashboard
 * Mirrors the backend API types
 */

export interface ProjectInfo {
  companyName: string;
  legalEntityName: string;
  publicRecordUrl: string;
  owners: string[];
  operatorAccountId: string;
  status: string;
  description?: string;
  audits?: AuditInfo[];
}

export interface AuditInfo {
  contractName?: string;
  contractAddress?: string;
  auditor: string;
  auditDate?: string;
  status: 'passed' | 'failed' | 'pending' | 'warning';
  findings?: string[];
  score?: number;
  reportUrl?: string;
}

export interface ThresholdInfo {
  accountId: string;
  threshold: number;
  totalKeys: number;
  keys: string[];
  agentPublicKey: string;
  balance?: string;
  memo?: string;
}

export interface ScheduledTransaction {
  schedule_id: string;
  creator_account_id: string;
  payer_account_id: string;
  transaction_body?: string;
  signatures: SignatureInfo[];
  executed_timestamp?: string;
  deleted?: boolean;
  status: 'pending' | 'signed' | 'rejected' | 'executed';
  requiresMySignature: boolean;
  rejection?: RejectionInfo;
}

export interface RejectionInfo {
  scheduleId: string;
  reviewer: string;
  functionName: string;
  reason: string;
  riskLevel: string;
  timestamp: string;
  consensusTimestamp: string;
}

export interface SignatureInfo {
  public_key_prefix: string;
  signature?: string;
  timestamp?: string;
  isAgent?: boolean;
  isInThreshold?: boolean;
}

export interface DashboardStats {
  totalScheduledTransactions: number;
  pendingSignatures: number;
  signedTransactions: number;
  rejectedTransactions: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

