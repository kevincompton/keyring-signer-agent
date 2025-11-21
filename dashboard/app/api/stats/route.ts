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

    const url = `${mirrorNodeUrl}/api/v1/schedules?account.id=${operatorAccountId}&order=desc&limit=100`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Mirror node request failed: ${response.status}`);
    }

    const data = await response.json();
    const schedules = data.schedules || [];

    const stats = {
      totalScheduledTransactions: schedules.length,
      pendingSignatures: schedules.filter((s: any) => !s.executed_timestamp && !s.deleted).length,
      signedTransactions: schedules.filter((s: any) => s.signatures?.length > 0 && !s.executed_timestamp).length,
      rejectedTransactions: schedules.filter((s: any) => s.deleted).length
    };

    return NextResponse.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

