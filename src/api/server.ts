/**
 * Express API Server for KeyRing Dashboard
 * Provides REST endpoints for the Next.js dashboard
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { Client, TopicId, AccountInfoQuery, AccountId } from '@hashgraph/sdk';
import type { 
  ApiResponse, 
  ProjectInfo, 
  ThresholdInfo, 
  ScheduledTransaction, 
  DashboardStats,
  TopicMessage 
} from '../types/api.js';

config();

const app = express();
const PORT = process.env.API_PORT || 3001;
const NETWORK = process.env.HEDERA_NETWORK || 'testnet';

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Hedera client
const client = NETWORK === 'mainnet' 
  ? Client.forMainnet() 
  : Client.forTestnet();

if (process.env.HEDERA_ACCOUNT_ID && process.env.HEDERA_PRIVATE_KEY) {
  client.setOperator(process.env.HEDERA_ACCOUNT_ID, process.env.HEDERA_PRIVATE_KEY);
}

const mirrorNodeUrl = NETWORK === 'mainnet'
  ? 'https://mainnet.mirrornode.hedera.com'
  : 'https://testnet.mirrornode.hedera.com';

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', network: NETWORK });
});

// Get project info from registry topic
app.get('/api/project', async (req: Request, res: Response) => {
  try {
    const topicId = process.env.PROJECT_REGISTRY_TOPIC;
    if (!topicId) {
      return res.status(400).json({
        success: false,
        error: 'PROJECT_REGISTRY_TOPIC not configured'
      } as ApiResponse<ProjectInfo>);
    }

    const url = `${mirrorNodeUrl}/api/v1/topics/${topicId}/messages?limit=10&order=desc`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Mirror node request failed: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.messages || data.messages.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No project data found in registry topic'
      } as ApiResponse<ProjectInfo>);
    }

    // Get the latest registration message
    const latestMessage = data.messages[0];
    const decoded = Buffer.from(latestMessage.message, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);

    const projectInfo: ProjectInfo = {
      companyName: parsed.metadata?.company_name || 'Unknown',
      legalEntityName: parsed.metadata?.legal_entity_name || 'Unknown',
      publicRecordUrl: parsed.metadata?.public_record_url || '',
      owners: parsed.metadata?.owners || [],
      operatorAccountId: parsed.metadata?.operatorAccountId || parsed.t_id || 'Unknown',
      status: parsed.metadata?.status || 'unknown',
      description: parsed.metadata?.description
    };

    return res.json({
      success: true,
      data: projectInfo
    } as ApiResponse<ProjectInfo>);

  } catch (error) {
    console.error('Error fetching project info:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    } as ApiResponse<ProjectInfo>);
  }
});

// Get threshold account info
app.get('/api/threshold', async (req: Request, res: Response) => {
  try {
    const thresholdAccountId = process.env.THRESHOLD_ACCOUNT_ID;
    if (!thresholdAccountId) {
      return res.status(400).json({
        success: false,
        error: 'THRESHOLD_ACCOUNT_ID not configured'
      } as ApiResponse<ThresholdInfo>);
    }

    const accountInfo = await new AccountInfoQuery()
      .setAccountId(AccountId.fromString(thresholdAccountId))
      .execute(client);

    const keyList = accountInfo.key;
    let keys: string[] = [];
    let threshold = 1;

    if (keyList && 'threshold' in keyList && '_keys' in keyList) {
      threshold = (keyList as any).threshold || 1;
      keys = (keyList as any)._keys?.map((k: any) => k.toString()) || [];
    }

    const thresholdInfo: ThresholdInfo = {
      accountId: thresholdAccountId,
      threshold,
      totalKeys: keys.length,
      keys,
      balance: accountInfo.balance.toString(),
      memo: accountInfo.accountMemo
    };

    return res.json({
      success: true,
      data: thresholdInfo
    } as ApiResponse<ThresholdInfo>);

  } catch (error) {
    console.error('Error fetching threshold info:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    } as ApiResponse<ThresholdInfo>);
  }
});

// Get scheduled transactions
app.get('/api/transactions', async (req: Request, res: Response) => {
  try {
    const operatorAccountId = process.env.LYNX_TESTNET_OPERATOR_ID;
    if (!operatorAccountId) {
      return res.status(400).json({
        success: false,
        error: 'LYNX_TESTNET_OPERATOR_ID not configured'
      } as ApiResponse<ScheduledTransaction[]>);
    }

    const agentPublicKey = process.env.OPERATOR_PUBLIC_KEY;
    if (!agentPublicKey) {
      return res.status(400).json({
        success: false,
        error: 'OPERATOR_PUBLIC_KEY not configured'
      } as ApiResponse<ScheduledTransaction[]>);
    }

    const url = `${mirrorNodeUrl}/api/v1/schedules?account.id=${operatorAccountId}&order=desc&limit=50`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Mirror node request failed: ${response.status}`);
    }

    const data = await response.json();
    const schedules = data.schedules || [];

    const transactions: ScheduledTransaction[] = schedules.map((schedule: any) => {
      let status: 'pending' | 'signed' | 'rejected' | 'executed' = 'pending';
      if (schedule.executed_timestamp) {
        status = 'executed';
      } else if (schedule.deleted) {
        status = 'rejected';
      }

      const mySignature = schedule.signatures?.find((sig: any) => {
        const sigKeyHex = Buffer.from(sig.public_key_prefix, 'base64').toString('hex');
        return sigKeyHex === agentPublicKey || agentPublicKey.includes(sigKeyHex);
      });

      if (mySignature && status === 'pending') {
        status = 'signed';
      }

      return {
        schedule_id: schedule.schedule_id,
        creator_account_id: schedule.creator_account_id,
        payer_account_id: schedule.payer_account_id,
        transaction_body: schedule.transaction_body,
        signatures: schedule.signatures || [],
        executed_timestamp: schedule.executed_timestamp,
        deleted: schedule.deleted,
        status,
        requiresMySignature: !mySignature && !schedule.executed_timestamp && !schedule.deleted
      };
    });

    return res.json({
      success: true,
      data: transactions
    } as ApiResponse<ScheduledTransaction[]>);

  } catch (error) {
    console.error('Error fetching transactions:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    } as ApiResponse<ScheduledTransaction[]>);
  }
});

// Get dashboard stats
app.get('/api/stats', async (req: Request, res: Response) => {
  try {
    const operatorAccountId = process.env.LYNX_TESTNET_OPERATOR_ID;
    if (!operatorAccountId) {
      return res.status(400).json({
        success: false,
        error: 'LYNX_TESTNET_OPERATOR_ID not configured'
      } as ApiResponse<DashboardStats>);
    }

    const url = `${mirrorNodeUrl}/api/v1/schedules?account.id=${operatorAccountId}&order=desc&limit=100`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Mirror node request failed: ${response.status}`);
    }

    const data = await response.json();
    const schedules = data.schedules || [];

    const stats: DashboardStats = {
      totalScheduledTransactions: schedules.length,
      pendingSignatures: schedules.filter((s: any) => !s.executed_timestamp && !s.deleted).length,
      signedTransactions: schedules.filter((s: any) => s.signatures?.length > 0 && !s.executed_timestamp).length,
      rejectedTransactions: schedules.filter((s: any) => s.deleted).length
    };

    return res.json({
      success: true,
      data: stats
    } as ApiResponse<DashboardStats>);

  } catch (error) {
    console.error('Error fetching stats:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    } as ApiResponse<DashboardStats>);
  }
});

// Trigger test transactions
app.post('/api/test-transactions', async (req: Request, res: Response) => {
  try {
    // Spawn the test transaction script as a child process
    const { spawn } = await import('child_process');
    
    const child = spawn('node', ['--loader', 'ts-node/esm', 'src/utils/createTestTransactions.ts'], {
      detached: true,
      stdio: 'ignore'
    });
    
    child.unref(); // Allow parent to exit independently

    res.json({
      success: true,
      message: 'Test transactions creation initiated in background'
    } as ApiResponse<void>);

  } catch (error) {
    console.error('Error triggering test transactions:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    } as ApiResponse<void>);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 KeyRing Dashboard API server running on port ${PORT}`);
  console.log(`📡 Network: ${NETWORK}`);
  console.log(`🌐 Mirror Node: ${mirrorNodeUrl}`);
});

export default app;

