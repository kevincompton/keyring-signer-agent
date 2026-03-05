// Load environment variables FIRST, before any other imports that depend on them
import { config } from 'dotenv';
config(); // Loads .env by default

// Now import everything else
import { Client, TopicMessageSubmitTransaction, TopicCreateTransaction, TopicInfoQuery, PrivateKey, AccountId, KeyList, PublicKey } from '@hashgraph/sdk';

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

function parseKeyToPublicKey(keyStr: string): PublicKey {
    try {
        if (keyStr.startsWith('302a') || keyStr.startsWith('302d')) return PublicKey.fromString(keyStr);
        if (keyStr.startsWith('302e')) return PrivateKey.fromString(keyStr).publicKey;
        if (keyStr.length === 64 && /^[0-9a-fA-F]+$/.test(keyStr)) return PublicKey.fromBytesED25519(Buffer.from(keyStr, 'hex'));
        return PublicKey.fromString(keyStr);
    } catch {
        throw new Error(`Failed to parse key: ${keyStr.slice(0, 20)}...`);
    }
}

/** Parse threshold signer public keys from env. Supports THRESHOLD_SIGNER_PUBLIC_KEYS (comma-separated) or OPERATOR_PUBLIC_KEY + TEST_SIGNER1/2. */
function parseThresholdSignerKeys(): PublicKey[] {
    const keysEnv = process.env.THRESHOLD_SIGNER_PUBLIC_KEYS;
    if (keysEnv) {
        const keys = keysEnv.split(',').map((k) => k.trim()).filter(Boolean);
        if (keys.length === 0) throw new Error('THRESHOLD_SIGNER_PUBLIC_KEYS is empty');
        return keys.map((keyStr, index) => {
            try {
                return parseKeyToPublicKey(keyStr);
            } catch (e) {
                throw new Error(`Failed to parse threshold signer key ${index + 1}: ${keyStr.slice(0, 20)}...`);
            }
        });
    }
    const operatorKey = process.env.OPERATOR_PUBLIC_KEY;
    const signer1 = process.env.TEST_SIGNER1;
    const signer2 = process.env.TEST_SIGNER2;
    const keys: PublicKey[] = [];
    if (operatorKey) keys.push(parseKeyToPublicKey(operatorKey));
    if (signer1) keys.push(parseKeyToPublicKey(signer1));
    if (signer2) keys.push(parseKeyToPublicKey(signer2));
    if (keys.length === 0) throw new Error('Set THRESHOLD_SIGNER_PUBLIC_KEYS (comma-separated) or OPERATOR_PUBLIC_KEY + TEST_SIGNER1/2');
    return keys;
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

    const signerKeys = parseThresholdSignerKeys();
    const submitKeyList = new KeyList(signerKeys, 1); // Any one threshold signer can submit

    // Create a new HCS-2 indexed topic for transaction rejections (Threshold signers only - private)
    console.log(`📝 Creating new Transaction Rejection topic on ${network.toUpperCase()} (HCS-2 indexed, private, ${signerKeys.length} signers)...`);
    const createTopicTx = new TopicCreateTransaction()
        .setTopicMemo('hcs-2:0:86400') // HCS-2 indexed topic, 24 hour TTL
        .setSubmitKey(submitKeyList)
        .setAdminKey(operatorKey.publicKey);

    const createResponse = await createTopicTx.execute(client);
    const createReceipt = await createResponse.getReceipt(client);
    const newTopicId = createReceipt.topicId!.toString();

    console.log(`✅ Created new ${network} rejection topic with ID:`, newTopicId);
    console.log(`\n📋 Add this to your .env file:\nPROJECT_REJECTION_TOPIC=${newTopicId}`);
    console.log(`\n💡 Threshold signers (submit key): Set THRESHOLD_SIGNER_PUBLIC_KEYS=key1,key2,key3 or use OPERATOR_PUBLIC_KEY + TEST_SIGNER1/2\n`);
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

