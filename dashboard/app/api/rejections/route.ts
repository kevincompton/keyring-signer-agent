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
    const rejectionTopicId = process.env.PROJECT_REJECTION_TOPIC;
    if (!rejectionTopicId) {
      return NextResponse.json({
        success: false,
        error: 'PROJECT_REJECTION_TOPIC not configured'
      }, { status: 400 });
    }

    // Fetch rejection messages from the topic
    const url = `${mirrorNodeUrl}/api/v1/topics/${rejectionTopicId}/messages?limit=100&order=desc`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Mirror node request failed: ${response.status}`);
    }

    const data = await response.json();
    const messages = data.messages || [];

    // Parse rejection messages
    const rejections: Record<string, any> = {};
    
    for (const message of messages) {
      try {
        const decoded = Buffer.from(message.message, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        
        // Store by scheduleId for easy lookup
        if (parsed.scheduleId) {
          rejections[parsed.scheduleId] = {
            scheduleId: parsed.scheduleId,
            reviewer: parsed.reviewer,
            functionName: parsed.functionName,
            reason: parsed.reason || parsed.reviewDescription,
            riskLevel: parsed.riskLevel,
            timestamp: parsed.timestamp,
            consensusTimestamp: message.consensus_timestamp
          };
        }
      } catch (err) {
        // Skip malformed messages
        console.error('Error parsing rejection message:', err);
      }
    }

    return NextResponse.json({
      success: true,
      data: rejections
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    });

  } catch (error) {
    console.error('Error fetching rejections:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

