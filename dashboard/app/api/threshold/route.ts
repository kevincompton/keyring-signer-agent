import { NextResponse } from 'next/server';
import { Client, AccountInfoQuery, AccountId } from '@hashgraph/sdk';

const NETWORK = process.env.HEDERA_NETWORK || 'testnet';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const thresholdAccountId = process.env.THRESHOLD_ACCOUNT_ID;
    if (!thresholdAccountId) {
      return NextResponse.json({
        success: false,
        error: 'THRESHOLD_ACCOUNT_ID not configured'
      }, { status: 400 });
    }

    // Initialize Hedera client
    const client = NETWORK === 'mainnet' 
      ? Client.forMainnet() 
      : Client.forTestnet();

    if (process.env.HEDERA_ACCOUNT_ID && process.env.HEDERA_PRIVATE_KEY) {
      client.setOperator(process.env.HEDERA_ACCOUNT_ID, process.env.HEDERA_PRIVATE_KEY);
    }

    const accountInfo = await new AccountInfoQuery()
      .setAccountId(AccountId.fromString(thresholdAccountId))
      .execute(client);

    client.close();

    const keyList = accountInfo.key;
    let keys: string[] = [];
    let threshold = 1;

    if (keyList && 'threshold' in keyList && '_keys' in keyList) {
      threshold = (keyList as any).threshold || 1;
      keys = (keyList as any)._keys?.map((k: any) => k.toString()) || [];
    }

    const agentPublicKey = process.env.OPERATOR_PUBLIC_KEY;

    const thresholdInfo = {
      accountId: thresholdAccountId,
      threshold,
      totalKeys: keys.length,
      keys,
      agentPublicKey: agentPublicKey || '',
      balance: accountInfo.balance.toString(),
      memo: accountInfo.accountMemo
    };

    return NextResponse.json({
      success: true,
      data: thresholdInfo
    });

  } catch (error) {
    console.error('Error fetching threshold info:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

