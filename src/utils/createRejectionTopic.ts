// Load environment variables FIRST, before any other imports that depend on them
import { config } from 'dotenv';
config(); // Loads .env by default

// Now import everything else
import { Client, TopicMessageSubmitTransaction, TopicCreateTransaction, TopicInfoQuery, PrivateKey, AccountId } from '@hashgraph/sdk';

// Get network from environment variable
const NETWORK = process.env.HEDERA_NETWORK || 'testnet';
const isMainnet = NETWORK === 'mainnet';

interface RejectionMessage {
    type: 'rejection';
    scheduleId: string;
    signer: string;
    feedback: string;
    timestamp: string;
    projectRegistrationTxId: string; // Transaction ID of the project registration
}

async function getOrCreateRejectionTopic(client: Client, network: string, operatorKey: PrivateKey): Promise<string> {
    // Check for existing topic ID in environment
    const existingTopicId = process.env.PROJECT_REJECTION_TOPIC;

    if (existingTopicId && existingTopicId !== '0.0.0') {
        try {
            // Try to query the existing topic to see if it's valid
            await new TopicInfoQuery()
                .setTopicId(existingTopicId)
                .execute(client);
            
            console.log(`✓ Using existing ${network} transaction rejection topic:`, existingTopicId);
            return existingTopicId;
        } catch (error) {
            console.log(`⚠️  Existing ${network} rejection topic not found or invalid, creating new topic...`);
        }
    }

    // Create a new HCS-2 indexed topic for transaction rejections
    console.log(`📝 Creating new Transaction Rejection topic on ${network.toUpperCase()} (HCS-2 indexed)...`);
    const createTopicTx = new TopicCreateTransaction()
        .setTopicMemo('hcs-2:0:86400') // HCS-2 indexed topic, 24 hour TTL
        .setSubmitKey(operatorKey.publicKey);

    const createResponse = await createTopicTx.execute(client);
    const createReceipt = await createResponse.getReceipt(client);
    const newTopicId = createReceipt.topicId!.toString();

    console.log(`✅ Created new ${network} rejection topic with ID:`, newTopicId);
    console.log(`\n📋 Add this to your .env file:\nPROJECT_REJECTION_TOPIC=${newTopicId}\n`);
    return newTopicId;
}

async function submitTestRejection() {
    try {
        console.log('\n🚫 KeyRing Transaction Rejection Topic Setup');
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
        
        console.log(`🔑 Operator Account: ${operatorId}\n`);
        
        // Configure client based on network
        const client = isMainnet 
            ? Client.forMainnet().setOperator(operatorId, operatorPrivateKey)
            : Client.forTestnet().setOperator(operatorId, operatorPrivateKey);
        
        const topicId = await getOrCreateRejectionTopic(client, NETWORK, operatorPrivateKey);

        // Example rejection message following the schema
        const rejectionData: RejectionMessage = {
            type: "rejection",
            scheduleId: "0.0.123456", // Example schedule ID
            signer: operatorId.toString(),
            feedback: "Transaction parameters do not match expected contract ABI. The function call appears to be targeting an unauthorized contract method.",
            timestamp: new Date().toISOString(),
            projectRegistrationTxId: process.env.LYNX_REGISTRATION_TX || "0.0.xxxxx@timestamp.sequence"
        };

        // Create HCS-2 message
        const hcs2Message = {
            "p": "hcs-2",
            "op": "rejection",
            "t_id": rejectionData.scheduleId, // Index by schedule ID for easy lookup
            "metadata": {
                type: rejectionData.type,
                schedule_id: rejectionData.scheduleId,
                signer: rejectionData.signer,
                feedback: rejectionData.feedback,
                timestamp: rejectionData.timestamp,
                project_registration_tx_id: rejectionData.projectRegistrationTxId
            },
            "m": "KeyRing threshold signer transaction rejection"
        };

        // Submit to HCS-2 topic
        const rejectionMessage = JSON.stringify(hcs2Message);
        const transaction = new TopicMessageSubmitTransaction()
            .setTopicId(topicId)
            .setMessage(rejectionMessage);

        const response = await transaction.execute(client);
        const receipt = await response.getReceipt(client);
        const transactionId = response.transactionId.toString();

        console.log('\n🎉 Rejection topic created and test message submitted!');
        console.log('═══════════════════════════════════════');
        console.log(`Network: ${NETWORK.toUpperCase()}`);
        console.log('Rejection Topic ID:', topicId);
        console.log('Transaction ID:', transactionId);
        console.log('Status:', receipt.status.toString());
        
        // Add network-specific explorer links
        const explorerBase = isMainnet 
            ? 'https://hashscan.io/mainnet' 
            : 'https://hashscan.io/testnet';
        console.log(`\n🔍 View on HashScan:`);
        console.log(`Topic: ${explorerBase}/topic/${topicId}`);
        console.log(`Transaction: ${explorerBase}/transaction/${transactionId}`);

        console.log('\n📋 HCS-2 Rejection Message Sent:');
        console.log(JSON.stringify(hcs2Message, null, 2));
        
        console.log('\n💡 Schema Format:');
        console.log('Rejection messages follow this structure:');
        console.log(JSON.stringify({
            type: "rejection",
            scheduleId: "0.0.xxxxx",
            signer: "0.0.xxxxx",
            feedback: "Detailed reason for rejection",
            timestamp: "ISO 8601 timestamp",
            projectRegistrationTxId: process.env.LYNX_REGISTRATION_TX || "0.0.xxxxx@timestamp.sequence"
        }, null, 2));
        
        console.log('\n✨ Rejection Topic Setup Complete!\n');
        
        // Close the client
        client.close();
        
    } catch (error) {
        console.error("\n❌ Error setting up rejection topic:", error);
        console.error('\n💡 Troubleshooting:');
        console.error('- Ensure HEDERA_NETWORK is set to "testnet" or "mainnet"');
        console.error('- Set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY in your .env file');
        console.error('- Check that your account has sufficient HBAR balance');
        console.error(`- Current network: ${NETWORK}\n`);
        throw error;
    }
}

// Run the script
submitTestRejection();

export { getOrCreateRejectionTopic, RejectionMessage };

