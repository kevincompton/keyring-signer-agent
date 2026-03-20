/**
 * Test script: verify ECDSA key parsing (raw hex or DER) for schedule_passive_agents.
 * Run: node --loader ts-node/esm src/tools/test-schedule-passive-key.ts
 */
import '../load-env.js';
import { parseEvmPrivateKey } from './schedule-passive-agents.js';
import { privateKeyToAccount } from 'viem/accounts';

const key = process.env.CONTRACT_OPERATOR_KEY ?? process.env.SCHEDULE_REVIEW_EVM_PRIVATE_KEY;

if (!key) {
    console.error('Missing CONTRACT_OPERATOR_KEY (or SCHEDULE_REVIEW_EVM_PRIVATE_KEY)');
    process.exit(1);
}

try {
    const parsed = parseEvmPrivateKey(key);
    const account = privateKeyToAccount(parsed);
    console.log('OK: ECDSA key parsed successfully');
    console.log('Derived EVM address:', account.address);
} catch (err) {
    console.error('FAIL:', err instanceof Error ? err.message : String(err));
    process.exit(1);
}
