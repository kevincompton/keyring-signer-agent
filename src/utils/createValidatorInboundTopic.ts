import '../load-env.js';

// Now import everything else
import {
    Client,
    TopicCreateTransaction,
    TopicUpdateTransaction,
    TopicInfoQuery,
    PrivateKey,
    AccountId,
    CustomFixedFee,
    Hbar,
} from '@hashgraph/sdk';

/** HIP-991 fee per message in HBAR. Default 1 HBAR. Lynx operator (submitter) is fee exempt. */
const DEFAULT_VALIDATOR_INBOUND_FEE_HBAR = 1;

const NETWORK = process.env.HEDERA_NETWORK || 'testnet';
const isMainnet = NETWORK === 'mainnet';

/** Parse Lynx operator private key (ED25519 hex or DER). Must match Lynx parseValidatorInboundKey exactly. */
function parseLynxOperatorKey(keyStr: string): PrivateKey {
    const raw = keyStr.trim();
    try {
        if (raw.startsWith('302') || raw.startsWith('30')) {
            return PrivateKey.fromStringDer(raw);
        }
        const k = raw.replace(/^0x/, '');
        if (k.length === 64 && /^[0-9a-fA-F]+$/.test(k)) {
            return PrivateKey.fromStringED25519(k);
        }
        return PrivateKey.fromString(raw);
    } catch (e) {
        throw new Error(`Invalid Lynx operator key: ${e instanceof Error ? e.message : String(e)}`);
    }
}

/**
 * Create or get validator inbound topic. HCS-2 non-indexed, HIP-991 fee (default 1 HBAR).
 * Lynx operator posts here to trigger the agent to check for schedules; Lynx is fee exempt.
 */
async function getOrCreateValidatorInboundTopic(
    client: Client,
    network: string,
    adminAccountId: AccountId,
    adminKey: PrivateKey,
    lynxOperatorKey: PrivateKey
): Promise<string> {
    const existingTopicId = process.env.PROJECT_VALIDATOR_INBOUND_TOPIC;

    if (existingTopicId && existingTopicId !== '0.0.0') {
        try {
            await new TopicInfoQuery()
                .setTopicId(existingTopicId)
                .execute(client);

            console.log(`✓ Updating existing ${network} validator inbound topic submit key:`, existingTopicId);
            const updateTx = new TopicUpdateTransaction()
                .setTopicId(existingTopicId)
                .setSubmitKey(lynxOperatorKey.publicKey);
            const updateResponse = await updateTx.execute(client);
            await updateResponse.getReceipt(client);
            console.log(`✅ Topic submit key synced to Lynx operator`);
            return existingTopicId;
        } catch (e) {
            console.log(`⚠️  Existing ${network} validator inbound topic not found or invalid:`, e instanceof Error ? e.message : e);
            console.log(`Creating new topic...`);
        }
    }

    const feeHbar = parseFloat(process.env.VALIDATOR_INBOUND_TOPIC_FEE_HBAR || String(DEFAULT_VALIDATOR_INBOUND_FEE_HBAR));
    const topicFee = new Hbar(feeHbar);

    // HCS-2 non-indexed: hcs-2:1:86400 (1 = non-indexed, 86400 = 24h TTL)
    console.log(`📝 Creating Validator Inbound topic on ${network.toUpperCase()} (HCS-2 non-indexed, HIP-991 fee ${feeHbar} HBAR, Lynx operator trigger)...`);

    const customFee = new CustomFixedFee({
        feeCollectorAccountId: adminAccountId,
    }).setHbarAmount(topicFee);

    const createTopicTx = new TopicCreateTransaction()
        .setTopicMemo('hcs-2:1:86400') // HCS-2 non-indexed, 24 hour TTL
        .setSubmitKey(lynxOperatorKey.publicKey) // Lynx operator posts to trigger agent
        .setAdminKey(adminKey.publicKey)
        .setFeeScheduleKey(adminKey.publicKey)
        .addFeeExemptKey(lynxOperatorKey.publicKey) // Lynx operator submits free
        .addCustomFee(customFee);

    const createResponse = await createTopicTx.execute(client);
    const createReceipt = await createResponse.getReceipt(client);
    const newTopicId = createReceipt.topicId!.toString();

    console.log(`✅ Created new ${network} validator inbound topic with ID:`, newTopicId);
    console.log(`   HIP-991 fee: ${feeHbar} HBAR per message (Lynx operator is fee exempt)`);
    console.log(`\n📋 Add this to your .env file:\nPROJECT_VALIDATOR_INBOUND_TOPIC=${newTopicId}`);
    console.log(`\n💡 Lynx operator posts to this topic to trigger the agent to check for schedules.\n`);
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

        console.log(`🔑 Agent Account (admin): ${operatorId}\n`);

        const lynxOperatorId = isMainnet ? process.env.LYNX_OPERATOR_ACCOUNT_ID : process.env.LYNX_TESTNET_OPERATOR_ID;
        const lynxOperatorKey = isMainnet ? process.env.LYNX_OPERATOR_KEY : process.env.LYNX_TESTNET_OPERATOR_KEY;

        if (!lynxOperatorId || !lynxOperatorKey) {
            throw new Error(
                `Missing Lynx operator credentials. Set ${isMainnet ? 'LYNX_OPERATOR_ACCOUNT_ID and LYNX_OPERATOR_KEY' : 'LYNX_TESTNET_OPERATOR_ID and LYNX_TESTNET_OPERATOR_KEY'}`
            );
        }

        const lynxOperatorPrivateKey = parseLynxOperatorKey(lynxOperatorKey);
        console.log(`📤 Lynx operator (submit/trigger): ${lynxOperatorId}\n`);

        const client = isMainnet
            ? Client.forMainnet().setOperator(operatorId, operatorPrivateKey)
            : Client.forTestnet().setOperator(operatorId, operatorPrivateKey);

        const topicId = await getOrCreateValidatorInboundTopic(client, NETWORK, operatorId, operatorPrivateKey, lynxOperatorPrivateKey);

        console.log('\n🎉 Validator inbound topic created successfully!');
        console.log('═══════════════════════════════════════');
        console.log(`Network: ${NETWORK.toUpperCase()}`);
        console.log('Validator Inbound Topic ID:', topicId);

        const explorerBase = isMainnet
            ? 'https://hashscan.io/mainnet'
            : 'https://hashscan.io/testnet';
        console.log(`\n🔍 View on HashScan:`);
        console.log(`Topic: ${explorerBase}/topic/${topicId}`);

        console.log('\n💡 Usage: Lynx operator posts a message to this topic to trigger the agent to check for pending schedules.');

        console.log('\n✨ Validator Inbound Topic Setup Complete!\n');

        client.close();
    } catch (error) {
        console.error('\n❌ Error setting up validator inbound topic:', error);
        console.error('\n💡 Troubleshooting:');
        console.error('- Ensure HEDERA_NETWORK is set to "testnet" or "mainnet"');
        console.error('- Set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY in your .env file');
        console.error('- Set Lynx operator credentials (LYNX_OPERATOR_ACCOUNT_ID/LYNX_OPERATOR_KEY or LYNX_TESTNET_*)');
        console.error(`- Current network: ${NETWORK}\n`);
        throw error;
    }
}

setupValidatorInboundTopic();

export { getOrCreateValidatorInboundTopic };
