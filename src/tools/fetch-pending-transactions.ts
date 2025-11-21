import { z } from 'zod';
import { StructuredTool } from '@langchain/core/tools';
import { Client } from '@hashgraph/sdk';

interface PendingSchedule {
    schedule_id: string;
    creator_account_id: string;
    payer_account_id: string;
    transaction_body: string;
    signatures?: Array<{ public_key_prefix: string }>;
    executed_timestamp?: string;
    deleted?: boolean;
}

export class FetchPendingTransactionsTool extends StructuredTool {
    name = 'fetch_pending_transactions';
    description = 'Fetch pending scheduled transactions from the Hedera mirror node that require this agent\'s signature. Queries schedules created by the project operator and filters for those involving accounts with threshold key lists containing this agent\'s public key.';
    schema = z.object({
        projectOperatorAccountId: z.string().describe('The operator account ID from the project registry that creates scheduled transactions'),
    });

    constructor(private client: Client) {
        super();
    }

    async _call(input: z.infer<typeof this.schema>): Promise<string> {
        const { projectOperatorAccountId } = input;

        try {
            // Get mirror node URL from client
            const mirrorNodeUrl = this.getMirrorNodeUrl();
            
            // Get this agent's public key from environment
            const agentPublicKey = process.env.OPERATOR_PUBLIC_KEY;
            if (!agentPublicKey) {
                throw new Error('OPERATOR_PUBLIC_KEY environment variable not set');
            }
            
            console.log(`[FETCH_PENDING_TX] Querying schedules from operator: ${projectOperatorAccountId}`);
            console.log(`[FETCH_PENDING_TX] Agent public key: ${agentPublicKey.slice(0, 20)}...`);

            // Query schedules from the project operator
            const response = await fetch(
                `${mirrorNodeUrl}/api/v1/schedules?account.id=${projectOperatorAccountId}&order=desc&limit=50`
            );

            if (!response.ok) {
                throw new Error(`Mirror node request failed: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const schedules: PendingSchedule[] = data.schedules || [];
            console.log(`[FETCH_PENDING_TX] Found ${schedules.length} schedules from ${projectOperatorAccountId}`);

            const allPendingSchedules: PendingSchedule[] = [];

            // Process each schedule
            for (const schedule of schedules) {
                // Skip executed or deleted schedules
                if (schedule.executed_timestamp || schedule.deleted) {
                    continue;
                }

                // Decode transaction body to find involved accounts
                try {
                    const txBodyBase64 = schedule.transaction_body;
                    const txBodyBytes = Buffer.from(txBodyBase64, 'base64');
                    const txBodyHex = txBodyBytes.toString('hex');

                    // Helper function to decode protobuf varint
                    const decodeVarint = (bytes: number[]): number => {
                        let result = 0;
                        let shift = 0;
                        for (const byte of bytes) {
                            result |= (byte & 0x7f) << shift;
                            if ((byte & 0x80) === 0) break;
                            shift += 7;
                        }
                        return result;
                    };

                    // Look for account IDs in the transaction body
                    // Account numbers are after 0x18 (field 3, varint) in protobuf
                    const accountsInTx: string[] = [];
                    for (let i = 0; i < txBodyHex.length - 2; i += 2) {
                        if (txBodyHex.slice(i, i + 2) === '18') {
                            // Found a field 3 (likely accountNum)
                            // Read the varint that follows
                            const varintBytes: number[] = [];
                            let offset = i + 2;
                            while (offset < txBodyHex.length) {
                                const byte = parseInt(txBodyHex.slice(offset, offset + 2), 16);
                                varintBytes.push(byte);
                                offset += 2;
                                if ((byte & 0x80) === 0) break; // Last byte of varint
                                if (varintBytes.length > 10) break; // Safety limit
                            }
                            if (varintBytes.length > 0) {
                                const accountNum = decodeVarint(varintBytes);
                                if (accountNum > 0 && accountNum < 100000000) { // Reasonable range
                                    accountsInTx.push(`0.0.${accountNum}`);
                                }
                            }
                        }
                    }

                    // Also check payer account - important for contract calls where payer is threshold list
                    if (schedule.payer_account_id && !accountsInTx.includes(schedule.payer_account_id)) {
                        accountsInTx.push(schedule.payer_account_id);
                    }

                    console.log(`[FETCH_PENDING_TX] Schedule ${schedule.schedule_id} involves accounts:`, accountsInTx);

                    // For each account in the transaction, check if it's a threshold list containing my key
                    let requiresMySignature = false;

                    for (const acctId of accountsInTx) {
                        // Fetch account to check if it has a KeyList
                        try {
                            const acctResponse = await fetch(
                                `${mirrorNodeUrl}/api/v1/accounts/${acctId}`
                            );
                            
                            if (!acctResponse.ok) continue;

                            const acctData = await acctResponse.json();
                            const key = acctData.key;

                            // Check if this is a KeyList (ProtobufEncoded)
                            if (key?._type === 'ProtobufEncoded' && key.key) {
                                const keyHex = key.key;
                                
                                // Check if agent's public key is in this KeyList
                                if (keyHex.includes(agentPublicKey)) {
                                    console.log(`[FETCH_PENDING_TX] Found my key in threshold list: ${acctId}`);
                                    
                                    const mySignature = schedule.signatures?.find((sig: any) => {
                                        // Compare public key prefix (base64 encoded) - must match OPERATOR_PUBLIC_KEY exactly
                                        const sigKeyHex = Buffer.from(sig.public_key_prefix, 'base64').toString('hex');
                                        return sigKeyHex === agentPublicKey || agentPublicKey.includes(sigKeyHex);
                                    });

                                    if (!mySignature) {
                                        requiresMySignature = true;
                                        console.log(`[FETCH_PENDING_TX] Schedule requires my signature: ${schedule.schedule_id}`);
                                        break;
                                    } else {
                                        console.log(`[FETCH_PENDING_TX] Already signed schedule: ${schedule.schedule_id}`);
                                    }
                                }
                            }
                        } catch (err) {
                            console.error(`[FETCH_PENDING_TX] Error checking account ${acctId}:`, err);
                        }
                    }

                    if (requiresMySignature) {
                        allPendingSchedules.push(schedule);
                    }

                } catch (err) {
                    console.error(`[FETCH_PENDING_TX] Error processing schedule: ${schedule.schedule_id}`, err);
                }
            }

            console.log(`[FETCH_PENDING_TX] Found ${allPendingSchedules.length} pending schedules requiring signature`);

            return JSON.stringify({
                success: true,
                count: allPendingSchedules.length,
                schedules: allPendingSchedules.map(s => ({
                    schedule_id: s.schedule_id,
                    creator_account_id: s.creator_account_id,
                    payer_account_id: s.payer_account_id,
                }))
            }, null, 2);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error('[FETCH_PENDING_TX] Error:', errorMessage);
            return JSON.stringify({
                success: false,
                error: errorMessage
            }, null, 2);
        }
    }

    private getMirrorNodeUrl(): string {
        // Get the mirror node URL from the client's mirror network
        const network = this.client.ledgerId?.toString() || 'testnet';
        
        if (network === 'mainnet') {
            return 'https://mainnet.mirrornode.hedera.com';
        }
        
        return 'https://testnet.mirrornode.hedera.com';
    }
}