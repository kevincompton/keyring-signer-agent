// Load environment variables FIRST, before any other imports that depend on them
import { config } from 'dotenv';
config(); // Loads .env by default

// Now import everything else
import { Client, TopicCreateTransaction, TopicInfoQuery, PrivateKey, AccountId } from '@hashgraph/sdk';

// Get network from environment variable
const NETWORK = process.env.HEDERA_NETWORK || 'testnet';
const isMainnet = NETWORK === 'mainnet';

interface ValidationMessage {
    scheduleId: string;
    reviewer: string;
    reviewDescription: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    timestamp: string;
    projectRegistrationTxId: string;
}

async function createValidatorTopic(client: Client, network: string, operatorKey: PrivateKey): Promise<string> {
    // Check for existing topic ID in environment
    const existingTopicId = process.env.PROJECT_VALIDATOR_TOPIC;

    if (existingTopicId && existingTopicId !== '0.0.0') {
        try {
            // Try to query the existing topic to see if it's valid
            await new TopicInfoQuery()
                .setTopicId(existingTopicId)
                .execute(client);
            
            console.log(`✓ Using existing ${network} validator topic:`, existingTopicId);
            return existingTopicId;
        } catch (error) {
            console.log(`⚠️  Existing ${network} validator topic not found or invalid, creating new topic...`);
        }
    }

    // Create a new HCS-2 indexed topic for agent validations
    console.log(`📝 Creating new Agent Validator topic on ${network.toUpperCase()} (HCS-2 indexed)...`);
    const createTopicTx = new TopicCreateTransaction()
        .setTopicMemo('hcs-2:0:86400') // HCS-2 indexed topic, 24 hour TTL
        .setSubmitKey(operatorKey.publicKey);

    const createResponse = await createTopicTx.execute(client);
    const createReceipt = await createResponse.getReceipt(client);
    const newTopicId = createReceipt.topicId!.toString();

    console.log(`✅ Created new ${network} validator topic with ID:`, newTopicId);
    console.log(`\n📋 Add this to your .env file:\nPROJECT_VALIDATOR_TOPIC=${newTopicId}\n`);
    return newTopicId;
}

async function setupValidatorTopic() {
    try {
        console.log('\n✅ KeyRing Agent Validator Topic Setup');
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
        
        const topicId = await createValidatorTopic(client, NETWORK, operatorPrivateKey);

        console.log('\n🎉 Validator topic created successfully!');
        console.log('═══════════════════════════════════════');
        console.log(`Network: ${NETWORK.toUpperCase()}`);
        console.log('Validator Topic ID:', topicId);
        
        // Add network-specific explorer links
        const explorerBase = isMainnet 
            ? 'https://hashscan.io/mainnet' 
            : 'https://hashscan.io/testnet';
        console.log(`\n🔍 View on HashScan:`);
        console.log(`Topic: ${explorerBase}/topic/${topicId}`);

        console.log('\n💡 Validation Message Schema:');
        console.log('Agent validation messages will follow this structure:');
        console.log(JSON.stringify({
            scheduleId: "0.0.xxxxx",
            reviewer: "0.0.xxxxx",
            reviewDescription: "Detailed review from agent",
            riskLevel: "low | medium | high | critical",
            timestamp: "ISO 8601 timestamp",
            projectRegistrationTxId: process.env.LYNX_REGISTRATION_TX || "0.0.xxxxx@timestamp.sequence"
        }, null, 2));

        console.log('\n📋 HCS-2 Message Format:');
        console.log(JSON.stringify({
            "p": "hcs-2",
            "op": "validation",
            "t_id": "0.0.xxxxx", // Schedule ID for indexing
            "metadata": {
                "schedule_id": "0.0.xxxxx",
                "reviewer": "0.0.xxxxx",
                "review_description": "Detailed review",
                "risk_level": "low",
                "timestamp": "ISO timestamp",
                "project_registration_tx_id": "0.0.xxxxx@timestamp.sequence"
            },
            "m": "KeyRing agent transaction validation"
        }, null, 2));
        
        console.log('\n✨ Validator Topic Setup Complete!\n');
        
        // Close the client
        client.close();
        
    } catch (error) {
        console.error("\n❌ Error setting up validator topic:", error);
        console.error('\n💡 Troubleshooting:');
        console.error('- Ensure HEDERA_NETWORK is set to "testnet" or "mainnet"');
        console.error('- Set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY in your .env file');
        console.error('- Check that your account has sufficient HBAR balance');
        console.error(`- Current network: ${NETWORK}\n`);
        throw error;
    }
}

// Run the script
setupValidatorTopic();

export { createValidatorTopic, ValidationMessage };

