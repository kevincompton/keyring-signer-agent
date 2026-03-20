/**
 * End-to-end test for schedule_passive_agents: simulates the contract call
 * so you can verify it works BEFORE deploying.
 *
 * Run: npm run test:schedule-passive-contract
 *
 * Uses same env as the agent. Fails fast if CONTRACT_OPERATOR_KEY missing or wrong.
 */
import '../load-env.js';
import { parseEvmPrivateKey } from './schedule-passive-agents.js';
import { createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const SCHEDULE_REVIEW_ABI = [
    {
        name: 'scheduleReviewTrigger',
        type: 'function',
        stateMutability: 'payable',
        inputs: [
            { name: 'scheduleId', type: 'string' },
            { name: 'durationSeconds', type: 'uint256' },
            { name: 'topicId1', type: 'string' },
            { name: 'topicId2', type: 'string' },
        ],
        outputs: [],
    },
] as const;

const ONE_HBAR = 100_000_000n;

function parseEntityNum(entityId: string): bigint {
    const match = entityId.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!match) throw new Error(`Invalid entity ID: ${entityId}`);
    return BigInt(match[3]);
}

function entityIdToEvmAddress(entityId: string): `0x${string}` {
    const num = parseEntityNum(entityId);
    return ('0x' + num.toString(16).padStart(40, '0')) as `0x${string}`;
}

const HEDERA_MAINNET = { id: 295, name: 'Hedera Mainnet', nativeCurrency: { decimals: 18, name: 'HBAR', symbol: 'HBAR' }, rpcUrls: { default: { http: ['https://mainnet.hashio.io/api'] } } } as const;
const HEDERA_TESTNET = { id: 296, name: 'Hedera Testnet', nativeCurrency: { decimals: 18, name: 'HBAR', symbol: 'HBAR' }, rpcUrls: { default: { http: ['https://testnet.hashio.io/api'] } } } as const;

async function main(): Promise<void> {
    const key = process.env.CONTRACT_OPERATOR_KEY ?? process.env.SCHEDULE_REVIEW_EVM_PRIVATE_KEY;
    if (!key) {
        console.error('FAIL: CONTRACT_OPERATOR_KEY (or SCHEDULE_REVIEW_EVM_PRIVATE_KEY) is not set.');
        console.error('Add it to .env and your deployment config. HEDERA_PRIVATE_KEY cannot be used.');
        process.exit(1);
    }

    const contractId = process.env.SCHEDULE_REVIEW_CONTRACT_ID;
    if (!contractId) {
        console.error('FAIL: SCHEDULE_REVIEW_CONTRACT_ID is not set.');
        process.exit(1);
    }

    const topicsRaw = process.env.PASSIVE_AGENT_INBOUND_TOPICS;
    const topics = topicsRaw?.split(',').map((t) => t.trim()).filter((t) => /^\d+\.\d+\.\d+$/.test(t)) ?? [];
    if (topics.length === 0) {
        console.error('FAIL: PASSIVE_AGENT_INBOUND_TOPICS is empty or invalid.');
        process.exit(1);
    }

    const network = process.env.HEDERA_NETWORK || 'testnet';
    const isMainnet = network === 'mainnet';
    const chain = isMainnet ? HEDERA_MAINNET : HEDERA_TESTNET;
    const rpcUrl = process.env.HEDERA_JSON_RPC_URL ?? chain.rpcUrls.default.http[0];

    let parsedKey: `0x${string}`;
    try {
        parsedKey = parseEvmPrivateKey(key);
    } catch (e) {
        console.error('FAIL: Key parse error:', e instanceof Error ? e.message : e);
        process.exit(1);
    }

    const account = privateKeyToAccount(parsedKey);
    const contractAddress = contractId.startsWith('0x') ? (contractId as `0x${string}`) : entityIdToEvmAddress(contractId);
    const topicId2 = topics.length >= 2 ? topics[1] : topics[0];

    console.log('Testing schedule_passive_agents simulation');
    console.log('  Network:', network);
    console.log('  Sender (CONTRACT_OPERATOR_KEY):', account.address);
    console.log('  Contract:', contractAddress);
    console.log('  Topics:', topics[0], topics.length >= 2 ? topics[1] : '(same)');

    const transport = http(rpcUrl);
    const publicClient = createPublicClient({ chain, transport });

    // Use dummy args for simulation - contract will revert (schedule fails) but we verify account exists
    const dummyScheduleId = '0.0.1';
    const dummyDuration = 60n;

    try {
        // Simulate via eth_call - will fail with "Sender account not found" if account doesn't exist
        await publicClient.simulateContract({
            address: contractAddress,
            abi: SCHEDULE_REVIEW_ABI,
            functionName: 'scheduleReviewTrigger',
            args: [dummyScheduleId, dummyDuration, topics[0], topicId2],
            value: ONE_HBAR,
            account,
        });
        console.log('OK: Simulation passed. Account exists and can call the contract.');
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Sender account not found')) {
            console.error('FAIL: Sender account not found.');
            console.error('  The EVM address', account.address, 'does not exist on', network + '.');
            console.error('  Ensure CONTRACT_OPERATOR_KEY is for account 0.0.9651200 (or your schedule creator).');
            console.error('  If on mainnet, the account must exist on mainnet.');
            process.exit(1);
        }
        // Other errors (e.g. contract revert) are OK for simulation - we only care that the account exists
        if (msg.includes('revert') || msg.includes('execution reverted')) {
            console.log('OK: Simulation reached contract (revert is expected with dummy args). Account exists.');
        } else {
            console.error('Simulation error:', msg);
            process.exit(1);
        }
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
