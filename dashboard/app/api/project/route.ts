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
    const topicId = process.env.PROJECT_REGISTRY_TOPIC;
    if (!topicId) {
      return NextResponse.json({
        success: false,
        error: 'PROJECT_REGISTRY_TOPIC not configured'
      }, { status: 400 });
    }

    const url = `${mirrorNodeUrl}/api/v1/topics/${topicId}/messages?limit=10&order=desc`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Mirror node request failed: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.messages || data.messages.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No project data found in registry topic'
      }, { status: 404 });
    }

    // Get the latest registration message
    const latestMessage = data.messages[0];
    const decoded = Buffer.from(latestMessage.message, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);

    // Fetch contracts list from contracts topic
    const contractsTopicId = process.env.PROJECT_CONTRACTS_TOPIC;
    let contracts: any[] = [];
    
    if (contractsTopicId) {
      try {
        const contractsUrl = `${mirrorNodeUrl}/api/v1/topics/${contractsTopicId}/messages?limit=1&order=desc`;
        const contractsResponse = await fetch(contractsUrl);
        
        if (contractsResponse.ok) {
          const contractsData = await contractsResponse.json();
          if (contractsData.messages && contractsData.messages.length > 0) {
            try {
              const decoded = Buffer.from(contractsData.messages[0].message, 'base64').toString('utf-8');
              const contractsParsed = JSON.parse(decoded);
              
              if (contractsParsed.metadata?.contracts && Array.isArray(contractsParsed.metadata.contracts)) {
                contracts = contractsParsed.metadata.contracts;
              }
            } catch (err) {
              console.error('Error parsing contracts data:', err);
            }
          }
        }
      } catch (err) {
        console.log('Could not fetch contracts info:', err);
      }
    }

    // Fetch audit information from audit topic (may be fragmented)
    const auditTopicId = process.env.PROJECT_AUDIT_TOPIC;
    let audits = [];
    
    if (auditTopicId) {
      try {
        // Fetch multiple messages in ascending order to handle fragmentation
        const auditUrl = `${mirrorNodeUrl}/api/v1/topics/${auditTopicId}/messages?limit=10&order=asc`;
        const auditResponse = await fetch(auditUrl);
        
        if (auditResponse.ok) {
          const auditData = await auditResponse.json();
          if (auditData.messages && auditData.messages.length > 0) {
            // Try to find a valid complete JSON message, or reconstruct from fragments
            let auditParsed = null;
            
            // First, try each message individually to find a complete one
            for (const message of auditData.messages) {
              try {
                const decoded = Buffer.from(message.message, 'base64').toString('utf-8');
                const parsed = JSON.parse(decoded);
                if (parsed.p === 'hcs-2' && parsed.op === 'audit_update') {
                  auditParsed = parsed;
                  break;
                }
              } catch (err) {
                // This message is a fragment or invalid, continue
              }
            }
            
            // If we didn't find a complete message, try concatenating all messages
            if (!auditParsed && auditData.messages.length > 1) {
              try {
                const concatenated = auditData.messages
                  .map((msg: any) => Buffer.from(msg.message, 'base64').toString('utf-8'))
                  .join('');
                auditParsed = JSON.parse(concatenated);
              } catch (err) {
                console.error('Error reconstructing fragmented audit data:', err);
              }
            }
            
            // Extract audit details if we found valid data
            if (auditParsed?.metadata?.contracts && Array.isArray(auditParsed.metadata.contracts)) {
              audits = auditParsed.metadata.contracts.map((contract: any) => ({
                contractName: contract.contract_name,
                contractAddress: contract.contract_address,
                auditor: contract.auditor,
                auditDate: contract.audit_date,
                status: contract.status,
                findings: contract.findings || [],
                score: contract.score,
                reportUrl: contract.report_url
              }));
            }
          }
        }
      } catch (err) {
        console.log('Could not fetch audit info:', err);
      }
    }

    const projectInfo = {
      companyName: parsed.metadata?.company_name || 'Unknown',
      legalEntityName: parsed.metadata?.legal_entity_name || 'Unknown',
      publicRecordUrl: parsed.metadata?.public_record_url || '',
      owners: parsed.metadata?.owners || [],
      operatorAccountId: parsed.metadata?.operatorAccountId || parsed.t_id || 'Unknown',
      status: parsed.metadata?.status || 'unknown',
      description: parsed.metadata?.description,
      contracts,
      audits
    };

    return NextResponse.json({
      success: true,
      data: projectInfo
    });

  } catch (error) {
    console.error('Error fetching project info:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

