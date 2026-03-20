import { z } from 'zod';
import { StructuredTool } from '@langchain/core/tools';
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { PrivateKey } from '@hashgraph/sdk';

/** ABI for scheduleReviewTrigger(uint256 scheduleId, uint256 durationSeconds, uint256 topicId1, uint256 topicId2) */
const SCHEDULE_REVIEW_ABI = [
    {
        name: 'scheduleReviewTrigger',
        type: 'function',
        stateMutability: 'payable',
        inputs: [
            { name: 'scheduleId', type: 'uint256' },
            { name: 'durationSeconds', type: 'uint256' },
            { name: 'topicId1', type: 'uint256' },
            { name: 'topicId2', type: 'uint256' },
        ],
        outputs: [],
    },
] as const;

/** Parse Hedera entity ID (0.0.xxxxx) to entity number (BigInt). */
function parseEntityNum(entityId: string): bigint {
    const match = entityId.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!match) throw new Error(`Invalid entity ID format: ${entityId}`);
    return BigInt(match[3]);
}

/** Convert Hedera entity ID (0.0.xxxxx) to EVM address (0x + 20 bytes). */
function entityIdToEvmAddress(entityId: string): `0x${string}` {
    const num = parseEntityNum(entityId);
    return ('0x' + num.toString(16).padStart(40, '0')) as `0x${string}`;
}

const HEDERA_CHAIN = {
    id: 296,
    name: 'Hedera Testnet',
    nativeCurrency: { decimals: 18, name: 'HBAR', symbol: 'HBAR' },
    rpcUrls: { default: { http: ['https://testnet.hashio.io/api'] } },
} as const;

const HEDERA_MAINNET_CHAIN = {
    id: 295,
    name: 'Hedera Mainnet',
    nativeCurrency: { decimals: 18, name: 'HBAR', symbol: 'HBAR' },
    rpcUrls: { default: { http: ['https://mainnet.hashio.io/api'] } },
} as const;

/** Parse ECDSA (secp256k1) private key from raw hex or DER. Returns 0x-prefixed hex for viem. */
export function parseEvmPrivateKey(key: string): `0x${string}` {
    const trimmed = key.trim().replace(/^0x/, '');
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        return (`0x${trimmed}`) as `0x${string}`;
    }
    if (PrivateKey.isDerKey(trimmed)) {
        const algo = PrivateKey.getAlgorithm(trimmed);
        if (algo !== 'ecdsa') {
            throw new Error('EVM requires ECDSA (secp256k1) key. DER key is ED25519.');
        }
        const pk = PrivateKey.fromString(key.trim());
        const raw = pk.toStringRaw();
        if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
            throw new Error('Failed to extract raw ECDSA key from DER');
        }
        return (`0x${raw}`) as `0x${string}`;
    }
    throw new Error('EVM private key must be 32-byte hex (secp256k1) or ECDSA DER. Got invalid format.');
}

export class SchedulePassiveAgentsTool extends StructuredTool {
    name = 'schedule_passive_agents';
    description = 'Schedule passive agents on the threshold list by calling the schedule review contract. Uses PASSIVE_AGENT_INBOUND_TOPICS (comma-separated topic IDs) and SCHEDULE_REVIEW_CONTRACT_ID from env. Requires scheduleId and durationSeconds. Sends 1 HBAR per call (value).';
    schema = z.object({
        scheduleId: z.string().describe('The schedule ID to trigger review for (format: 0.0.xxxxx)'),
        durationSeconds: z.number().int().positive().describe('Duration in seconds for the review trigger'),
    });

    /** EVM signer for scheduleReviewTrigger. Uses secp256k1 (ECDSA) key. Prefers CONTRACT_OPERATOR_KEY (schedule creator 0.0.9651200). Supports raw hex or DER. */
    private getEvmPrivateKey(): `0x${string}` {
        const key = process.env.CONTRACT_OPERATOR_KEY
            ?? process.env.SCHEDULE_REVIEW_EVM_PRIVATE_KEY
            ?? process.env.HEDERA_PRIVATE_KEY;
        if (!key) throw new Error('Missing CONTRACT_OPERATOR_KEY (or SCHEDULE_REVIEW_EVM_PRIVATE_KEY / HEDERA_PRIVATE_KEY)');
        return parseEvmPrivateKey(key);
    }

    private getContractAddress(): `0x${string}` {
        const addr = process.env.SCHEDULE_REVIEW_CONTRACT_ID;
        if (!addr) throw new Error('Missing SCHEDULE_REVIEW_CONTRACT_ID');
        if (addr.startsWith('0x')) return addr as `0x${string}`;
        return entityIdToEvmAddress(addr);
    }

    private getPassiveTopics(): string[] {
        const raw = process.env.PASSIVE_AGENT_INBOUND_TOPICS;
        if (!raw?.trim()) return [];
        return raw.split(',').map((t) => t.trim()).filter((t) => /^\d+\.\d+\.\d+$/.test(t));
    }

    async _call(input: z.infer<typeof this.schema>): Promise<string> {
        const { scheduleId, durationSeconds } = input;

        const topics = this.getPassiveTopics();
        if (topics.length === 0) {
            return JSON.stringify({
                success: false,
                error: 'PASSIVE_AGENT_INBOUND_TOPICS is empty or not set',
                message: 'No passive agent topics to schedule',
            }, null, 2);
        }

        const topicId1 = parseEntityNum(topics[0]);
        const topicId2 = topics.length >= 2 ? parseEntityNum(topics[1]) : topicId1;
        const scheduleIdNum = parseEntityNum(scheduleId);
        const contractAddress = this.getContractAddress();

        const isMainnet = (process.env.HEDERA_NETWORK || 'testnet') === 'mainnet';
        const chain = isMainnet ? HEDERA_MAINNET_CHAIN : HEDERA_CHAIN;
        const rpcUrl = process.env.HEDERA_JSON_RPC_URL ?? chain.rpcUrls.default.http[0];

        try {
            const account = privateKeyToAccount(this.getEvmPrivateKey());
            const transport = http(rpcUrl);

            const publicClient = createPublicClient({ chain, transport });
            const walletClient = createWalletClient({ chain, transport, account });

            console.log(`[SCHEDULE_PASSIVE] Calling scheduleReviewTrigger for schedule ${scheduleId}`);

            const hash = await walletClient.writeContract({
                address: contractAddress,
                abi: SCHEDULE_REVIEW_ABI,
                functionName: 'scheduleReviewTrigger',
                args: [scheduleIdNum, BigInt(durationSeconds), topicId1, topicId2],
                value: parseEther('1'),
                account,
            });

            if (!hash) {
                throw new Error('Transaction returned no hash');
            }

            const receipt = await publicClient.waitForTransactionReceipt({ hash });

            console.log(`[SCHEDULE_PASSIVE] Success: tx ${hash}`);

            return JSON.stringify({
                success: true,
                transactionHash: hash,
                blockNumber: receipt.blockNumber?.toString(),
                scheduleId,
                topicId1: topics[0],
                topicId2: topics.length >= 2 ? topics[1] : topics[0],
                message: `Successfully scheduled passive agent review for ${scheduleId}`,
            }, null, 2);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('[SCHEDULE_PASSIVE] Error:', errorMessage);
            return JSON.stringify({
                success: false,
                scheduleId,
                error: errorMessage,
                message: `Failed to schedule passive agents for ${scheduleId}`,
            }, null, 2);
        }
    }
}
