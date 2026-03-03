// Load environment variables FIRST, before any other imports that depend on them
import { config } from 'dotenv';
config(); // Loads .env by default

// Now import everything else
import {
    Client,
    TopicCreateTransaction,
    TopicInfoQuery,
    PrivateKey,
    AccountId,
    CustomFixedFee,
    Hbar,
} from '@hashgraph/sdk';

// Get network from environment variable
const NETWORK = process.env.HEDERA_NETWORK || 'testnet';
const isMainnet = NETWORK === 'mainnet';

/** Fee per message submission in HBAR (HIP-991). Default 0.01 HBAR. */
const DEFAULT_TOPIC_FEE_HBAR = 0.01;

async function getOrCreateValidatorInboundTopic(
    client: Client,
    network: string,
    operatorId: AccountId,
    operatorKey: PrivateKey
): Promise<string> {
    const existingTopicId = process.env.PROJECT_VALIDATOR_INBOUND_TOPIC;

    if (existingTopicId && existingTopicId !== '0.0.0') {
        try {
            await new TopicInfoQuery()
                .setTopicId(existingTopicId)
                .execute(client);

            console.log(`✓ Using existing ${network} validator inbound topic:`, existingTopicId);
            return existingTopicId;
        } catch {
            console.log(`⚠️  Existing ${network} validator inbound topic not found or invalid, creating new topic...`);
        }
    }

    const feeHbar = parseFloat(process.env.VALIDATOR_INBOUND_TOPIC_FEE_HBAR || String(DEFAULT_TOPIC_FEE_HBAR));
    const topicFee = new Hbar(feeHbar);

    console.log(`📝 Creating Validator Inbound topic on ${network.toUpperCase()} (HCS-2 non-indexed, HIP-991 fees: ${topicFee} per message)...`);

    const customFee = new CustomFixedFee({
        feeCollectorAccountId: operatorId,
    }).setHbarAmount(topicFee);

    const createTopicTx = new TopicCreateTransaction()
        .setTopicMemo(`hcs-2:${operatorId}:validator-inbound`) // HCS-2 non-indexed
        .setFeeScheduleKey(operatorKey.publicKey)
        .addFeeExemptKey(operatorKey.publicKey) // Operator can submit without paying
        .addCustomFee(customFee);

    const createResponse = await createTopicTx.execute(client);
    const createReceipt = await createResponse.getReceipt(client);
    const newTopicId = createReceipt.topicId!.toString();

    console.log(`✅ Created new ${network} validator inbound topic with ID:`, newTopicId);
    console.log(`\n📋 Add this to your .env file:\nPROJECT_VALIDATOR_INBOUND_TOPIC=${newTopicId}\n`);
    return newTopicId;
}

async function setupValidatorInboundTopic() {
    try {
        console.log('\n📥 KeyRing Validator Inbound Topic Setup');
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

        console.log(`🔑 Operator Account: ${operatorId}\n`);

        const client = isMainnet
            ? Client.forMainnet().setOperator(operatorId, operatorPrivateKey)
            : Client.forTestnet().setOperator(operatorId, operatorPrivateKey);

        const topicId = await getOrCreateValidatorInboundTopic(client, NETWORK, operatorId, operatorPrivateKey);

        console.log('\n🎉 Validator inbound topic created successfully!');
        console.log('═══════════════════════════════════════');
        console.log(`Network: ${NETWORK.toUpperCase()}`);
        console.log('Validator Inbound Topic ID:', topicId);

        const explorerBase = isMainnet
            ? 'https://hashscan.io/mainnet'
            : 'https://hashscan.io/testnet';
        console.log(`\n🔍 View on HashScan:`);
        console.log(`Topic: ${explorerBase}/topic/${topicId}`);

        const feeHbar = process.env.VALIDATOR_INBOUND_TOPIC_FEE_HBAR || String(DEFAULT_TOPIC_FEE_HBAR);
        console.log('\n💡 HIP-991 Topic Fees:');
        console.log(`   - Fee per message: ${feeHbar} HBAR`);
        console.log('   - Fee collector: operator account');
        console.log('   - Fee exempt: operator key (validator can submit free)');
        console.log('   - Public submissions: pay fee to submit');

        console.log('\n✨ Validator Inbound Topic Setup Complete!\n');

        client.close();
    } catch (error) {
        console.error('\n❌ Error setting up validator inbound topic:', error);
        console.error('\n💡 Troubleshooting:');
        console.error('- Ensure HEDERA_NETWORK is set to "testnet" or "mainnet"');
        console.error('- Set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY in your .env file');
        console.error('- Check that your account has sufficient HBAR balance');
        console.error(`- Current network: ${NETWORK}\n`);
        throw error;
    }
}

// Run the script
setupValidatorInboundTopic();

export { getOrCreateValidatorInboundTopic };
