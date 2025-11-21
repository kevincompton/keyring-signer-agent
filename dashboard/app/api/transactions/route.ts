import { NextResponse } from 'next/server';

const NETWORK = process.env.HEDERA_NETWORK || 'testnet';
const mirrorNodeUrl = NETWORK === 'mainnet'
  ? 'https://mainnet.mirrornode.hedera.com'
  : 'https://testnet.mirrornode.hedera.com';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const operatorAccountId = process.env.LYNX_TESTNET_OPERATOR_ID;
    if (!operatorAccountId) {
      return NextResponse.json({
        success: false,
        error: 'LYNX_TESTNET_OPERATOR_ID not configured'
      }, { status: 400 });
    }

    const agentPublicKey = process.env.OPERATOR_PUBLIC_KEY;
    if (!agentPublicKey) {
      return NextResponse.json({
        success: false,
        error: 'OPERATOR_PUBLIC_KEY not configured'
      }, { status: 400 });
    }

    // Get threshold account keys to identify legitimate signers
    const thresholdAccountId = process.env.THRESHOLD_ACCOUNT_ID;
    let thresholdKeys: string[] = [];
    
    if (thresholdAccountId) {
      try {
        const { Client, AccountInfoQuery, AccountId } = await import('@hashgraph/sdk');
        const network = process.env.HEDERA_NETWORK || 'testnet';
        const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
        
        if (process.env.HEDERA_ACCOUNT_ID && process.env.HEDERA_PRIVATE_KEY) {
          client.setOperator(process.env.HEDERA_ACCOUNT_ID, process.env.HEDERA_PRIVATE_KEY);
        }
        
        const accountInfo = await new AccountInfoQuery()
          .setAccountId(AccountId.fromString(thresholdAccountId))
          .execute(client);
        
        client.close();
        
        const keyList = accountInfo.key;
        if (keyList && 'threshold' in keyList && '_keys' in keyList) {
          thresholdKeys = (keyList as any)._keys?.map((k: any) => k.toString()) || [];
        }
      } catch (err) {
        console.error('Error fetching threshold keys:', err);
      }
    }

    const url = `${mirrorNodeUrl}/api/v1/schedules?account.id=${operatorAccountId}&order=desc&limit=50`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Mirror node request failed: ${response.status}`);
    }

    const data = await response.json();
    const schedules = data.schedules || [];

    const transactions = schedules.map((schedule: any) => {
      let status: 'pending' | 'signed' | 'rejected' | 'executed' = 'pending';
      if (schedule.executed_timestamp) {
        status = 'executed';
      } else if (schedule.deleted) {
        status = 'rejected';
      }
      // If not executed/rejected, it's still pending (even with signatures)

      // Mark which signatures are from the agent and which are legitimate threshold signers
      const signatures = (schedule.signatures || []).map((sig: any) => {
        const sigKeyHex = Buffer.from(sig.public_key_prefix, 'base64').toString('hex');
        
        // Extract raw key bytes from DER format for comparison
        // DER format: 302a300506032b6570032100 (prefix) + 32 bytes (64 hex chars)
        const sigKeyRaw = sigKeyHex.length > 64 ? sigKeyHex.slice(-64) : sigKeyHex;
        const agentKeyRaw = agentPublicKey.length > 64 ? agentPublicKey.slice(-64) : agentPublicKey;
        
        const isAgentSignature = sigKeyRaw === agentKeyRaw || sigKeyHex === agentPublicKey;
        
        // Check if this signature is from a key in the threshold KeyList
        const isInThreshold = thresholdKeys.some(thresholdKey => {
          const thresholdKeyRaw = thresholdKey.length > 64 ? thresholdKey.slice(-64) : thresholdKey;
          return sigKeyRaw === thresholdKeyRaw || sigKeyHex === thresholdKey;
        });
        
        return {
          ...sig,
          isAgent: isAgentSignature,
          isInThreshold
        };
      });

      const mySignature = signatures.find((sig: any) => sig.isAgent);

      return {
        schedule_id: schedule.schedule_id,
        creator_account_id: schedule.creator_account_id,
        payer_account_id: schedule.payer_account_id,
        transaction_body: schedule.transaction_body,
        signatures: signatures,
        executed_timestamp: schedule.executed_timestamp,
        deleted: schedule.deleted,
        status,
        requiresMySignature: !mySignature && !schedule.executed_timestamp && !schedule.deleted
      };
    });

    return NextResponse.json({
      success: true,
      data: transactions
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    });

  } catch (error) {
    console.error('Error fetching transactions:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

