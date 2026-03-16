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
    PublicKey,
    CustomFixedFee,
    Hbar,
} from '@hashgraph/sdk';

// Get network from environment variable
const NETWORK = process.env.HEDERA_NETWORK || 'testnet';
const isMainnet = NETWORK === 'mainnet';

/** Fee per message submission in HBAR (HIP-991). Default 0.01 HBAR. */
const DEFAULT_TOPIC_FEE_HBAR = 0.01;

function parseKeyringOperatorPublicKey(keyString: string): PublicKey {
    const trimmed = keyString.trim();
    try {
        // DER format (starts with 302a)
        if (trimmed.startsWith('302a')) {
            return PublicKey.fromString(trimmed);
        }
        // Raw hex (64 chars = 32 bytes)
        if (trimmed.length === 64 && /^[0-9a-fA-F]+$/.test(trimmed)) {
            return PublicKey.fromBytesED25519(Buffer.from(trimmed, 'hex'));
        }
        return PublicKey.fromString(trimmed);
    } catch (err) {
        throw new Error(`Invalid KEYRING_OPERATOR_PUBLIC_KEY: ${err instanceof Error ? err.message : String(err)}`);
    }
}

async function getOrCreateOperatorInboundTopic(
    client: Client,
    network: string,
    payerId: AccountId,
    payerKey: PrivateKey,
    keyringOperatorId: AccountId,
    keyringOperatorPublicKey: PublicKey
): Promise<string> {
    const existingTopicId = process.env.KEYRING_OPERATOR_INBOUND_TOPIC_ID;

    if (existingTopicId && existingTopicId !== '0.0.0') {
        try {
            await new TopicInfoQuery()
                .setTopicId(existingTopicId)
                .execute(client);

            console.log(`✓ Using existing ${network} operator inbound topic:`, existingTopicId);
            return existingTopicId;
        } catch {
            console.log(`⚠️  Existing ${network} operator inbound topic not found or invalid, creating new topic...`);
        }
    }

    const feeHbar = parseFloat(process.env.OPERATOR_INBOUND_TOPIC_FEE_HBAR || String(DEFAULT_TOPIC_FEE_HBAR));
    const topicFee = new Hbar(feeHbar);

    console.log(`📝 Creating Operator Inbound topic on ${network.toUpperCase()} (HCS-2 non-indexed, restricted to KeyRing operator ${keyringOperatorId})...`);

    const customFee = new CustomFixedFee({
        feeCollectorAccountId: payerId,
    }).setHbarAmount(topicFee);

    const createTopicTx = new TopicCreateTransaction()
        .setTopicMemo(`hcs-2:${keyringOperatorId}:operator-inbound`) // HCS-2 non-indexed
        .setSubmitKey(keyringOperatorPublicKey) // Only KeyRing operator can submit
        .setAdminKey(payerKey.publicKey) // Payer (agent) can manage topic
        .setFeeScheduleKey(payerKey.publicKey)
        .addFeeExemptKey(keyringOperatorPublicKey) // KeyRing operator submits free
        .addCustomFee(customFee);

    const createResponse = await createTopicTx.execute(client);
    const createReceipt = await createResponse.getReceipt(client);
    const newTopicId = createReceipt.topicId!.toString();

    console.log(`✅ Created new ${network} operator inbound topic with ID:`, newTopicId);
    console.log(`\n📋 Add this to your .env file:\nKEYRING_OPERATOR_INBOUND_TOPIC_ID=${newTopicId}\n`);
    return newTopicId;
}

async function setupOperatorInboundTopic() {
    try {
        console.log('\n📥 KeyRing Operator Inbound Topic Setup');
        console.log('═══════════════════════════════════════\n');

        if (!NETWORK || (NETWORK !== 'testnet' && NETWORK !== 'mainnet')) {
            throw new Error('HEDERA_NETWORK must be set to "testnet" or "mainnet"');
        }

        console.log(`📡 Network: ${NETWORK.toUpperCase()}`);

        const accountIdValue = process.env.HEDERA_ACCOUNT_ID;
        const privateKeyValue = process.env.HEDERA_PRIVATE_KEY;
        const keyringOperatorIdValue = process.env.KEYRING_OPERATOR_ACCOUNT_ID;
        const keyringOperatorPubKeyValue = process.env.KEYRING_OPERATOR_PUBLIC_KEY;

        if (!accountIdValue) {
            throw new Error('Missing HEDERA_ACCOUNT_ID environment variable');
        }
        if (!privateKeyValue) {
            throw new Error('Missing HEDERA_PRIVATE_KEY environment variable');
        }
        if (!keyringOperatorIdValue) {
            throw new Error('Missing KEYRING_OPERATOR_ACCOUNT_ID environment variable');
        }
        if (!keyringOperatorPubKeyValue) {
            throw new Error('Missing KEYRING_OPERATOR_PUBLIC_KEY environment variable (hex or DER format)');
        }

        const payerId = AccountId.fromString(accountIdValue);
        const keyringOperatorId = AccountId.fromString(keyringOperatorIdValue);
        let payerPrivateKey: PrivateKey;
        let keyringOperatorPublicKey: PublicKey;

        try {
            payerPrivateKey = PrivateKey.fromStringDer(privateKeyValue);
        } catch (error) {
            console.error('❌ Error parsing HEDERA_PRIVATE_KEY:', error);
            throw error;
        }

        try {
            keyringOperatorPublicKey = parseKeyringOperatorPublicKey(keyringOperatorPubKeyValue);
        } catch (error) {
            console.error('❌ Error parsing KEYRING_OPERATOR_PUBLIC_KEY:', error);
            throw error;
        }

        console.log(`🔑 Payer (topic creator): ${payerId}`);
        console.log(`🔐 KeyRing operator (submit-only): ${keyringOperatorId}\n`);

        const client = isMainnet
            ? Client.forMainnet().setOperator(payerId, payerPrivateKey)
            : Client.forTestnet().setOperator(payerId, payerPrivateKey);

        const topicId = await getOrCreateOperatorInboundTopic(
            client,
            NETWORK,
            payerId,
            payerPrivateKey,
            keyringOperatorId,
            keyringOperatorPublicKey
        );

        console.log('\n🎉 Operator inbound topic created successfully!');
        console.log('═══════════════════════════════════════');
        console.log(`Network: ${NETWORK.toUpperCase()}`);
        console.log('Operator Inbound Topic ID:', topicId);

        const explorerBase = isMainnet
            ? 'https://hashscan.io/mainnet'
            : 'https://hashscan.io/testnet';
        console.log(`\n🔍 View on HashScan:`);
        console.log(`Topic: ${explorerBase}/topic/${topicId}`);

        const feeHbar = process.env.OPERATOR_INBOUND_TOPIC_FEE_HBAR || String(DEFAULT_TOPIC_FEE_HBAR);
        console.log('\n💡 Topic restrictions:');
        console.log('   - Submit key: KeyRing operator only (private)');
        console.log('   - HCS-2 non-indexed');
        console.log(`   - Fee per message (if applicable): ${feeHbar} HBAR`);
        console.log('   - KeyRing operator: fee exempt');

        console.log('\n✨ Operator Inbound Topic Setup Complete!\n');

        client.close();
    } catch (error) {
        console.error('\n❌ Error setting up operator inbound topic:', error);
        console.error('\n💡 Troubleshooting:');
        console.error('- Ensure HEDERA_NETWORK is set to "testnet" or "mainnet"');
        console.error('- Set HEDERA_ACCOUNT_ID, HEDERA_PRIVATE_KEY in your .env file');
        console.error('- Set KEYRING_OPERATOR_ACCOUNT_ID and KEYRING_OPERATOR_PUBLIC_KEY');
        console.error('- KEYRING_OPERATOR_PUBLIC_KEY: hex (64 chars) or DER format');
        console.error(`- Current network: ${NETWORK}\n`);
        throw error;
    }
}

// Run the script
setupOperatorInboundTopic();

export { getOrCreateOperatorInboundTopic };
