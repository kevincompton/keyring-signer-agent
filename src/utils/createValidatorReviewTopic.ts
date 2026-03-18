import '../load-env.js';

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

async function createValidatorReviewTopic(
    client: Client,
    network: string,
    adminKey: PrivateKey
): Promise<string> {
    const existingTopicId = (process.env.PROJECT_VALIDATOR_REVIEW_TOPIC ?? '').trim();

    if (existingTopicId && existingTopicId !== '0.0.0') {
        try {
            await new TopicInfoQuery()
                .setTopicId(existingTopicId)
                .execute(client);

            console.log(`✓ Using existing ${network} validator review topic:`, existingTopicId);
            return existingTopicId;
        } catch {
            console.log(`⚠️  Existing ${network} validator review topic not found or invalid, creating new topic...`);
        }
    }

    // Submit key: agent only (HEDERA_ACCOUNT_ID). Admin: agent.
    console.log(`📝 Creating new Validator Review topic on ${network.toUpperCase()} (HCS-2 indexed, agent submit-only)...`);
    const createTopicTx = new TopicCreateTransaction()
        .setTopicMemo('hcs-2:0:86400') // HCS-2 indexed topic, 24 hour TTL
        .setSubmitKey(adminKey.publicKey)
        .setAdminKey(adminKey.publicKey);

    const createResponse = await createTopicTx.execute(client);
    const createReceipt = await createResponse.getReceipt(client);
    const newTopicId = createReceipt.topicId!.toString();

    console.log(`✅ Created new ${network} validator review topic with ID:`, newTopicId);
    console.log(`\n📋 Add this to your .env file:\nPROJECT_VALIDATOR_REVIEW_TOPIC=${newTopicId}`);
    console.log(`\n💡 Submit key: agent only (HEDERA_ACCOUNT_ID)\n`);
    return newTopicId;
}

async function setupValidatorReviewTopic() {
    try {
        console.log('\n✅ KeyRing Validator Review Topic Setup');
        console.log('═══════════════════════════════════════\n');

        if (!NETWORK || (NETWORK !== 'testnet' && NETWORK !== 'mainnet')) {
            throw new Error('HEDERA_NETWORK must be set to "testnet" or "mainnet"');
        }

        console.log(`📡 Network: ${NETWORK.toUpperCase()}`);

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
            console.error('❌ Error parsing private key:', error);
            throw error;
        }

        console.log(`🔑 Agent Account (admin): ${operatorId}\n`);

        const client = isMainnet
            ? Client.forMainnet().setOperator(operatorId, operatorPrivateKey)
            : Client.forTestnet().setOperator(operatorId, operatorPrivateKey);

        const topicId = await createValidatorReviewTopic(client, NETWORK, operatorPrivateKey);

        console.log('\n🎉 Validator review topic created successfully!');
        console.log('═══════════════════════════════════════');
        console.log(`Network: ${NETWORK.toUpperCase()}`);
        console.log('Validator Review Topic ID:', topicId);

        const explorerBase = isMainnet
            ? 'https://hashscan.io/mainnet'
            : 'https://hashscan.io/testnet';
        console.log(`\n🔍 View on HashScan:`);
        console.log(`Topic: ${explorerBase}/topic/${topicId}`);

        console.log('\n💡 Validation Message Schema:');
        console.log('Agent validation messages will follow this structure:');
        console.log(JSON.stringify({
            scheduleId: '0.0.xxxxx',
            reviewer: '0.0.xxxxx',
            reviewDescription: 'Detailed review from agent',
            riskLevel: 'low | medium | high | critical',
            timestamp: 'ISO 8601 timestamp',
            projectRegistrationTxId: process.env.LYNX_REGISTRATION_TX || '0.0.xxxxx@timestamp.sequence'
        }, null, 2));

        console.log('\n✨ Validator Review Topic Setup Complete!\n');

        client.close();
    } catch (error) {
        console.error('\n❌ Error setting up validator review topic:', error);
        console.error('\n💡 Troubleshooting:');
        console.error('- Ensure HEDERA_NETWORK is set to "testnet" or "mainnet"');
        console.error('- Set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY in your .env file');
        console.error(`- Current network: ${NETWORK}\n`);
        throw error;
    }
}

setupValidatorReviewTopic();

export { createValidatorReviewTopic, ValidationMessage };
