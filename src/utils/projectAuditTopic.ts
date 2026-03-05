// Load environment variables FIRST, before any other imports that depend on them
import { config } from 'dotenv';
config(); // Loads .env by default

// Now import everything else
import { Client, TopicMessageSubmitTransaction, TopicCreateTransaction, TopicInfoQuery, PrivateKey, AccountId } from '@hashgraph/sdk';

// Get network from environment variable
const NETWORK = process.env.HEDERA_NETWORK || 'testnet';
const isMainnet = NETWORK === 'mainnet';

interface ContractAudit {
    contractAddress: string;
    contractName?: string;
    auditDate?: string;
    auditor?: string;
    status: 'passed' | 'failed' | 'pending' | 'warning';
    findings?: string[];
    score?: number;
    reportUrl?: string;
}

interface ProjectAuditData {
    projectAccountId: string;
    projectName: string;
    projectRegistrationTxId?: string; // Transaction ID of the project registration message
    projectMessage?: any; // Original message from projectTopic
    contracts: ContractAudit[];
    lastUpdated: string;
}

async function createProjectAuditTopic(client: Client, projectAccountId: string, operatorKey: PrivateKey): Promise<string> {
    // Create a new HCS-2 indexed topic for this project's contract audits (Keyring operator only - private)
    console.log(`📝 Creating Project Audit Topic for ${projectAccountId} (HCS-2 indexed, private)...`);
    
    const createTopicTx = new TopicCreateTransaction()
        .setTopicMemo(`hcs-2:0:86400`) // HCS-2 indexed, 24 hour TTL
        .setSubmitKey(operatorKey.publicKey)
        .setAdminKey(operatorKey.publicKey);

    const createResponse = await createTopicTx.execute(client);
    const createReceipt = await createResponse.getReceipt(client);
    const newTopicId = createReceipt.topicId!.toString();

    console.log(`✅ Created audit topic for project ${projectAccountId}:`, newTopicId);
    console.log(`📋 Topic ID: ${newTopicId}\n`);
    
    return newTopicId;
}

async function submitAuditUpdate(auditData: ProjectAuditData, topicId?: string): Promise<void> {
    try {
        console.log('\n🔍 KeyRing Project Audit Submission');
        console.log('═══════════════════════════════════════\n');
        
        // Validate network configuration
        if (!NETWORK || (NETWORK !== 'testnet' && NETWORK !== 'mainnet')) {
            throw new Error('HEDERA_NETWORK must be set to "testnet" or "mainnet"');
        }
        
        console.log(`📡 Network: ${NETWORK.toUpperCase()}`);
        
        // Get credentials from environment
        const accountIdValue = process.env.HEDERA_ACCOUNT_ID;
        const privateKeyValue = process.env.HEDERA_PRIVATE_KEY;
        
        if (!accountIdValue) {
            throw new Error('Missing HEDERA_ACCOUNT_ID environment variable');
        }
        if (!privateKeyValue) {
            throw new Error('Missing HEDERA_PRIVATE_KEY environment variable');
        }
        
        const operatorId = AccountId.fromString(accountIdValue);
        let operatorPrivateKey: PrivateKey;

        try {
            operatorPrivateKey = PrivateKey.fromStringDer(privateKeyValue);
        } catch (error) {
            console.error("❌ Error parsing private key:", error);
            throw error;
        }
        
        console.log(`🔑 Operator Account: ${operatorId}`);
        console.log(`📋 Project Account: ${auditData.projectAccountId}\n`);
        
        // Configure client based on network
        const client = isMainnet 
            ? Client.forMainnet().setOperator(operatorId, operatorPrivateKey)
            : Client.forTestnet().setOperator(operatorId, operatorPrivateKey);
        
        // Get or create audit topic for this project
        let auditTopicId = topicId;
        
        if (!auditTopicId) {
            // Check environment for existing topic
            auditTopicId = process.env.PROJECT_AUDIT_TOPIC;
        }
        
        if (!auditTopicId || auditTopicId === '0.0.0') {
            // Create new audit topic
            auditTopicId = await createProjectAuditTopic(client, auditData.projectAccountId, operatorPrivateKey);
        } else {
            // Validate existing topic
            try {
                await new TopicInfoQuery()
                    .setTopicId(auditTopicId)
                    .execute(client);
                console.log(`✓ Using existing audit topic: ${auditTopicId}\n`);
            } catch (error) {
                console.log(`⚠️  Existing topic not found, creating new topic...`);
                auditTopicId = await createProjectAuditTopic(client, auditData.projectAccountId, operatorPrivateKey);
            }
        }

        // Create HCS-2 audit message
        const hcs2AuditMessage = {
            "p": "hcs-2",
            "op": "audit_update",
            "t_id": auditData.projectAccountId,
            "metadata": {
                project_name: auditData.projectName,
                project_registration_tx_id: auditData.projectRegistrationTxId,
                project_message: auditData.projectMessage,
                contracts: auditData.contracts.map(contract => ({
                    contract_address: contract.contractAddress,
                    contract_name: contract.contractName,
                    audit_date: contract.auditDate,
                    auditor: contract.auditor,
                    status: contract.status,
                    findings: contract.findings,
                    score: contract.score,
                    report_url: contract.reportUrl
                })),
                last_updated: auditData.lastUpdated,
                updated_by: operatorId.toString()
            },
            "m": "KeyRing project contract audit update"
        };

        // Submit to HCS-2 audit topic (non-indexed, most recent message matters)
        const auditMessage = JSON.stringify(hcs2AuditMessage);
        const transaction = new TopicMessageSubmitTransaction()
            .setTopicId(auditTopicId)
            .setMessage(auditMessage);

        const response = await transaction.execute(client);
        const receipt = await response.getReceipt(client);
        const transactionId = response.transactionId.toString();

        console.log('\n🎉 Audit update submitted successfully!');
        console.log('═══════════════════════════════════════');
        console.log(`Network: ${NETWORK.toUpperCase()}`);
        console.log('Audit Topic ID:', auditTopicId);
        console.log('Transaction ID:', transactionId);
        console.log('Status:', receipt.status.toString());
        
        // Add network-specific explorer links
        const explorerBase = isMainnet 
            ? 'https://hashscan.io/mainnet' 
            : 'https://hashscan.io/testnet';
        console.log(`\n🔍 View on HashScan:`);
        console.log(`Topic: ${explorerBase}/topic/${auditTopicId}`);
        console.log(`Transaction: ${explorerBase}/transaction/${transactionId}`);

        console.log('\n📋 HCS-2 Audit Message:');
        console.log(JSON.stringify(hcs2AuditMessage, null, 2));
        
        console.log('\n💡 Note: This is an HCS-2 indexed topic.');
        console.log('Each contract audit is indexed by contract address for easy lookup.\n');
        
        console.log('\n✨ Audit Submission Complete!\n');
        
        // Close the client
        client.close();
        
    } catch (error) {
        console.error("\n❌ Error submitting audit update:", error);
        console.error('\n💡 Troubleshooting:');
        console.error('- Ensure HEDERA_NETWORK is set to "testnet" or "mainnet"');
        console.error('- Set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY in your .env file');
        console.error('- Check that your account has sufficient HBAR balance');
        console.error(`- Current network: ${NETWORK}\n`);
        throw error;
    }
}

// Lynx project audit
async function sendTestAudit() {
    const lynxAuditData: ProjectAuditData = {
        projectAccountId: "0.0.4337514",
        projectName: "Lynxify",
        projectRegistrationTxId: process.env.LYNX_REGISTRATION_TX || "0.0.xxxxx@timestamp.sequence",
        projectMessage: {
            company_name: "Lynxify",
            legal_entity_name: "Lynxify LLC",
            status: "verified"
        },
        contracts: [
            {
                contractAddress: "0.0.9766114",
                contractName: "LynxToken",
                auditDate: new Date().toISOString(),
                auditor: "KeyRing Security Team",
                status: "passed",
                findings: [
                    "✅ Uses OpenZeppelin's TransparentUpgradeableProxy - industry standard",
                    "✅ Minimal attack surface with proxy pattern",
                    "✅ Admin separation enforced by proxy",
                    "✅ Follows Solidity 0.8.0+ best practices"
                ],
                score: 95,
                reportUrl: "https://github.com/Lynxify/lynx-contracts/blob/main/contracts/LynxToken.sol"
            },
            {
                contractAddress: "0.0.9778566",
                contractName: "DepositMinterV2",
                auditDate: new Date().toISOString(),
                auditor: "KeyRing Security Team",
                status: "passed",
                findings: [
                    "✅ UUPS upgradeable pattern with proper authorization",
                    "✅ Governance-adjustable ratios with safety bounds (1-100)",
                    "✅ Proper HTS integration with Hedera precompile",
                    "✅ Comprehensive event logging for all operations",
                    "✅ Staking reward calculations included in mint/burn",
                    "✅ Reentrancy protection through external HTS calls",
                    "⚠️ Complexity: Multi-token basket with dynamic ratios",
                    "ℹ️ Admin controls: Can adjust supply and update ratios",
                    "ℹ️ Supply key held by contract for mint/burn operations",
                    "ℹ️ Treasury receives minted tokens, requires proper key management"
                ],
                score: 90,
                reportUrl: "https://github.com/Lynxify/lynx-contracts/blob/main/contracts/DepositMinterV2.sol"
            }
        ],
        lastUpdated: new Date().toISOString()
    };

    await submitAuditUpdate(lynxAuditData);
}

// Run the example if executed directly
sendTestAudit();

export { submitAuditUpdate, createProjectAuditTopic, ProjectAuditData, ContractAudit };

