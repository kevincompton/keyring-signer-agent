/**
 * Shared API types for KeyRing Signer Agent Dashboard
 * Used by both backend and frontend
 */

export interface ContractInfo {
  contract_address: string;
  contract_name: string;
  contract_type: string;
  version: string;
  deployed_date: string;
  description: string;
  audit_topic_id?: string;
}

export interface ContractAudit {
  contractName: string;
  contractAddress: string;
  auditor: string;
  auditDate: string;
  status: string;
  findings: string[];
  score: number;
  reportUrl?: string;
}

export interface ProjectInfo {
  companyName: string;
  legalEntityName: string;
  publicRecordUrl: string;
  owners: string[];
  operatorAccountId: string;
  status: string;
  description?: string;
  contracts?: ContractInfo[];
  audits?: ContractAudit[];
}

export interface ThresholdInfo {
  accountId: string;
  threshold: number;
  totalKeys: number;
  keys: string[];
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
}

export interface SignatureInfo {
  public_key_prefix: string;
  signature?: string;
  timestamp?: string;
}

export interface TopicMessage {
  sequence: number;
  timestamp: string;
  content: any;
  raw: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface DashboardStats {
  totalScheduledTransactions: number;
  pendingSignatures: number;
  signedTransactions: number;
  rejectedTransactions: number;
}

