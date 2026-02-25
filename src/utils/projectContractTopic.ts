// Load environment variables FIRST, before any other imports that depend on them
import { config } from 'dotenv';
config(); // Loads .env by default

// Now import everything else
import { Client, TopicMessageSubmitTransaction, TopicCreateTransaction, TopicInfoQuery, PrivateKey, AccountId } from '@hashgraph/sdk';

// Get network from environment variable
const NETWORK = process.env.HEDERA_NETWORK || 'testnet';
const isMainnet = NETWORK === 'mainnet';

interface ContractInfo {
    contractAddress: string;
    contractName: string;
    contractType?: string;
    version?: string;
    deployedDate?: string;
    description?: string;
    auditTopicId?: string; // Reference to audit topic for lookups
}

interface ProjectContractsData {
    projectAccountId: string;
    projectName: string;
    projectRegistrationTxId?: string; // Transaction ID of the project registration message
    contracts: ContractInfo[];
    lastUpdated: string;
}

async function createProjectContractTopic(client: Client, projectAccountId: string, operatorKey: PrivateKey): Promise<string> {
    // Create a new HCS-2 non-indexed topic for this project's contract list
    console.log(`📝 Creating Project Contracts Topic for ${projectAccountId} (HCS-2 non-indexed)...`);
    
    const createTopicTx = new TopicCreateTransaction()
        .setTopicMemo(`hcs-2:${projectAccountId}:contracts`) // HCS-2 non-indexed, project-specific
        .setSubmitKey(operatorKey.publicKey);

    const createResponse = await createTopicTx.execute(client);
    const createReceipt = await createResponse.getReceipt(client);
    const newTopicId = createReceipt.topicId!.toString();

    console.log(`✅ Created contracts topic for project ${projectAccountId}:`, newTopicId);
    console.log(`📋 Topic ID: ${newTopicId}\n`);
    
    return newTopicId;
}

async function submitContractList(contractsData: ProjectContractsData, topicId?: string): Promise<void> {
    try {
        console.log('\n📜 KeyRing Project Contracts Submission');
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
        console.log(`📋 Project Account: ${contractsData.projectAccountId}`);
        console.log(`📦 Contracts: ${contractsData.contracts.length}\n`);
        
        // Configure client based on network
        const client = isMainnet 
            ? Client.forMainnet().setOperator(operatorId, operatorPrivateKey)
            : Client.forTestnet().setOperator(operatorId, operatorPrivateKey);
        
        // Get or create contracts topic for this project
        let contractsTopicId = topicId;
        
        if (!contractsTopicId) {
            // Check environment for existing topic
            contractsTopicId = process.env.PROJECT_CONTRACTS_TOPIC;
        }
        
        if (!contractsTopicId || contractsTopicId === '0.0.0') {
            // Create new contracts topic
            contractsTopicId = await createProjectContractTopic(client, contractsData.projectAccountId, operatorPrivateKey);
        } else {
            // Validate existing topic
            try {
                await new TopicInfoQuery()
                    .setTopicId(contractsTopicId)
                    .execute(client);
                console.log(`✓ Using existing contracts topic: ${contractsTopicId}\n`);
            } catch (error) {
                console.log(`⚠️  Existing topic not found, creating new topic...`);
                contractsTopicId = await createProjectContractTopic(client, contractsData.projectAccountId, operatorPrivateKey);
            }
        }

        // Create HCS-2 contracts message
        const hcs2ContractsMessage = {
            "p": "hcs-2",
            "op": "contracts_update",
            "t_id": contractsData.projectAccountId,
            "metadata": {
                project_name: contractsData.projectName,
                project_registration_tx_id: contractsData.projectRegistrationTxId,
                contracts: contractsData.contracts.map(contract => ({
                    contract_address: contract.contractAddress,
                    contract_name: contract.contractName,
                    contract_type: contract.contractType,
                    version: contract.version,
                    deployed_date: contract.deployedDate,
                    description: contract.description,
                    audit_topic_id: contract.auditTopicId
                })),
                total_contracts: contractsData.contracts.length,
                last_updated: contractsData.lastUpdated,
                updated_by: operatorId.toString()
            },
            "m": "KeyRing project active contracts list"
        };

        // Submit to HCS-2 contracts topic (non-indexed, most recent message is current)
        const contractsMessage = JSON.stringify(hcs2ContractsMessage);
        const transaction = new TopicMessageSubmitTransaction()
            .setTopicId(contractsTopicId)
            .setMessage(contractsMessage);

        const response = await transaction.execute(client);
        const receipt = await response.getReceipt(client);
        const transactionId = response.transactionId.toString();

        console.log('\n🎉 Contract list submitted successfully!');
        console.log('═══════════════════════════════════════');
        console.log(`Network: ${NETWORK.toUpperCase()}`);
        console.log('Contracts Topic ID:', contractsTopicId);
        console.log('Transaction ID:', transactionId);
        console.log('Status:', receipt.status.toString());
        
        // Add network-specific explorer links
        const explorerBase = isMainnet 
            ? 'https://hashscan.io/mainnet' 
            : 'https://hashscan.io/testnet';
        console.log(`\n🔍 View on HashScan:`);
        console.log(`Topic: ${explorerBase}/topic/${contractsTopicId}`);
        console.log(`Transaction: ${explorerBase}/transaction/${transactionId}`);

        console.log('\n📋 HCS-2 Contracts Message:');
        console.log(JSON.stringify(hcs2ContractsMessage, null, 2));
        
        console.log('\n💡 Note: This is an HCS-2 non-indexed topic.');
        console.log('The most recent message represents the current active contracts.');
        console.log('Use contract addresses to look up audits in the audit topic.\n');
        
        console.log('\n✨ Contract List Submission Complete!\n');
        
        // Close the client
        client.close();
        
    } catch (error) {
        console.error("\n❌ Error submitting contract list:", error);
        console.error('\n💡 Troubleshooting:');
        console.error('- Ensure HEDERA_NETWORK is set to "testnet" or "mainnet"');
        console.error('- Set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY in your .env file');
        console.error('- Check that your account has sufficient HBAR balance');
        console.error(`- Current network: ${NETWORK}\n`);
        throw error;
    }
}

// Example usage
async function sendTestContracts() {
    // Get audit topic from environment
    const auditTopicId = process.env.PROJECT_AUDIT_TOPIC;

    if (!auditTopicId) {
        console.warn('⚠️  PROJECT_AUDIT_TOPIC not set - contracts will not reference an audit topic');
    }

    const contractsTopicId = '0.0.7289727';

    const testContractsData: ProjectContractsData = {
        projectAccountId: "0.0.4337514",
        projectName: "Lynxify",
        projectRegistrationTxId: "0.0.4337514@1771959014.121126452",
        contracts: [
            {
                contractAddress: "0.0.8027033",
                contractName: "Lynx LP Manager",
                contractType: "Smart Contract",
                version: "1.0.0",
                deployedDate: new Date().toISOString(),
                description: "Lynx LP Manager - monitors actual testnet transactions",
                auditTopicId: auditTopicId
            }
        ],
        lastUpdated: new Date().toISOString()
    };

    await submitContractList(testContractsData, contractsTopicId);
}

// Run the example if executed directly
sendTestContracts();

export { submitContractList, createProjectContractTopic, ProjectContractsData, ContractInfo };

