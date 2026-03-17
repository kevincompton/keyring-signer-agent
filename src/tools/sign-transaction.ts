import { z } from 'zod';
import { StructuredTool } from '@langchain/core/tools';
import { Client, ScheduleSignTransaction, ScheduleId } from '@hashgraph/sdk';

export class SignTransactionTool extends StructuredTool {
    name = 'sign_transaction';
    description = 'Sign a pending scheduled transaction on the Hedera blockchain using this agent\'s private key. Requires the schedule ID of the transaction to sign. Returns ALREADY_EXECUTED, SCHEDULE_DELETED, or SCHEDULE_NOT_FOUND if the schedule is no longer signable - do not retry in those cases.';
    schema = z.object({
        scheduleId: z.string().describe('The schedule ID to sign (format: 0.0.xxxxx)'),
    });

    constructor(private client: Client) {
        super();
    }

    private getMirrorNodeUrl(): string {
        const fromClient = this.client.ledgerId?.toString()?.toLowerCase();
        const network = fromClient === 'mainnet' || fromClient === 'testnet'
            ? fromClient
            : (process.env.HEDERA_NETWORK || 'testnet').toLowerCase();
        return network === 'mainnet' ? 'https://mainnet.mirrornode.hedera.com' : 'https://testnet.mirrornode.hedera.com';
    }

    async _call(input: z.infer<typeof this.schema>): Promise<string> {
        const { scheduleId } = input;

        try {
            console.log(`[SIGN_TX] Signing scheduled transaction: ${scheduleId}`);

            // Pre-check: verify schedule is still signable (not executed/deleted) before attempting network call
            const mirrorUrl = this.getMirrorNodeUrl();
            const scheduleRes = await fetch(`${mirrorUrl}/api/v1/schedules/${scheduleId}`);
            if (!scheduleRes.ok) {
                const msg = `Schedule ${scheduleId} not found (${scheduleRes.status}) - may be executed, deleted, or invalid`;
                console.log(`[SIGN_TX] ${msg}`);
                return JSON.stringify({ success: false, scheduleId, error: 'SCHEDULE_NOT_FOUND', message: msg }, null, 2);
            }
            const scheduleData = await scheduleRes.json();
            if (scheduleData.executed_timestamp) {
                const msg = `Schedule ${scheduleId} already executed at ${scheduleData.executed_timestamp} - no signing needed`;
                console.log(`[SIGN_TX] ${msg}`);
                return JSON.stringify({ success: false, scheduleId, error: 'ALREADY_EXECUTED', message: msg }, null, 2);
            }
            if (scheduleData.deleted) {
                const msg = `Schedule ${scheduleId} has been deleted - cannot sign`;
                console.log(`[SIGN_TX] ${msg}`);
                return JSON.stringify({ success: false, scheduleId, error: 'SCHEDULE_DELETED', message: msg }, null, 2);
            }

            // Parse the schedule ID
            const scheduleIdObj = ScheduleId.fromString(scheduleId);

            // Create and execute the schedule sign transaction
            const signTx = await new ScheduleSignTransaction()
                .setScheduleId(scheduleIdObj)
                .execute(this.client);

            // Get the receipt to confirm the signature was added
            const receipt = await signTx.getReceipt(this.client);

            console.log(`[SIGN_TX] Successfully signed schedule ${scheduleId}`);
            console.log(`[SIGN_TX] Transaction ID: ${signTx.transactionId}`);
            console.log(`[SIGN_TX] Status: ${receipt.status.toString()}`);

            return JSON.stringify({
                success: true,
                scheduleId: scheduleId,
                transactionId: signTx.transactionId?.toString(),
                status: receipt.status.toString(),
                message: `Successfully signed scheduled transaction ${scheduleId}`
            }, null, 2);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[SIGN_TX] Error signing schedule ${scheduleId}:`, errorMessage);
            
            return JSON.stringify({
                success: false,
                scheduleId: scheduleId,
                error: errorMessage,
                message: `Failed to sign scheduled transaction ${scheduleId}`
            }, null, 2);
        }
    }
}

