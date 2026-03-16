import { z } from 'zod';
import { StructuredTool } from '@langchain/core/tools';
import { Client } from '@hashgraph/sdk';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';

export class GetScheduleInfoTool extends StructuredTool {
    name = 'get_schedule_info';
    description = 'Get detailed information about a specific scheduled transaction from the Hedera mirror node, including the transaction memo, creator, payer, decoded contract function calls, and parameters.';
    schema = z.object({
        scheduleId: z.string().describe('The schedule ID to query (format: 0.0.xxxxx)'),
    });

    private depositMinterAbi: any[];
    private vaultLPManagerAbi: any[];

    constructor(private client: Client) {
        super();
        this.depositMinterAbi = this.loadAbi('DepositMinterV2.json');
        this.vaultLPManagerAbi = this.loadAbi('VaultLPManager.json');
    }

    private loadAbi(filename: string): any[] {
        try {
            const abiPath = join(process.cwd(), 'src/projects/abi', filename);
            return JSON.parse(readFileSync(abiPath, 'utf-8')).abi;
        } catch (error) {
            console.warn(`[GET_SCHEDULE] Could not load ${filename}, function decoding may be limited`);
            return [];
        }
    }

    async _call(input: z.infer<typeof this.schema>): Promise<string> {
        const { scheduleId } = input;

        try {
            const mirrorNodeUrl = this.getMirrorNodeUrl();
            
            console.log(`[GET_SCHEDULE] Fetching details for schedule: ${scheduleId}`);

            // Query schedule from mirror node
            const response = await fetch(
                `${mirrorNodeUrl}/api/v1/schedules/${scheduleId}`
            );

            if (!response.ok) {
                throw new Error(`Mirror node request failed: ${response.status} ${response.statusText}`);
            }

            const scheduleData = await response.json();
            
            console.log(`[GET_SCHEDULE] Successfully retrieved schedule: ${scheduleId}`);

            // Decode contract call if present
            const contractCallDetails = this.decodeContractCall(scheduleData);

            // Extract key information
            const expirationTime = scheduleData.expiration_time || null;
            const info = {
                scheduleId: scheduleData.schedule_id,
                creatorAccountId: scheduleData.creator_account_id,
                payerAccountId: scheduleData.payer_account_id,
                memo: scheduleData.memo || 'No memo',
                adminKey: scheduleData.admin_key,
                executed: scheduleData.executed_timestamp ? true : false,
                deleted: scheduleData.deleted || false,
                signatures: scheduleData.signatures?.length || 0,
                signaturesRequired: scheduleData.signatures?.length || 0,
                transactionType: scheduleData.transaction_body ? this.detectTransactionType(scheduleData.transaction_body) : 'Unknown',
                contractCall: contractCallDetails,
                expirationTime,
                ...(expirationTime && {
                    secondsUntilExpiry: Math.floor((new Date(expirationTime).getTime() - Date.now()) / 1000),
                    secondsUntilOneHourBeforeExpiry: Math.max(0, Math.floor((new Date(expirationTime).getTime() - Date.now()) / 1000) - 3600),
                }),
            };

            return JSON.stringify({
                success: true,
                schedule: info,
                rawData: {
                    memo: scheduleData.memo,
                    executed_timestamp: scheduleData.executed_timestamp,
                    deleted: scheduleData.deleted,
                    signatures: scheduleData.signatures,
                    expiration_time: expirationTime
                }
            }, null, 2);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error('[GET_SCHEDULE] Error:', errorMessage);
            return JSON.stringify({
                success: false,
                error: errorMessage,
                scheduleId: scheduleId
            }, null, 2);
        }
    }

    private getMirrorNodeUrl(): string {
        const network = this.client.ledgerId?.toString() || 'testnet';
        
        if (network === 'mainnet') {
            return 'https://mainnet.mirrornode.hedera.com';
        }
        
        return 'https://testnet.mirrornode.hedera.com';
    }

    private detectTransactionType(transactionBody: string): string {
        // Transaction body is base64 encoded protobuf
        // We can detect type by checking which fields are present
        try {
            const decoded = Buffer.from(transactionBody, 'base64');
            // This is a simplified detection - in reality you'd parse the protobuf
            // For now, we'll check common patterns
            if (decoded.includes(Buffer.from('contractCall'))) {
                return 'ContractExecuteTransaction';
            }
            return 'ContractExecuteTransaction'; // Assume contract call for now
        } catch {
            return 'Unknown';
        }
    }

    private decodeContractCall(scheduleData: any): any {
        try {
            const txBody = scheduleData.transaction_body;
            if (!txBody) {
                return { decoded: false, reason: 'No transaction body' };
            }

            // Decode base64-encoded protobuf transaction body
            const txBodyBytes = Buffer.from(txBody, 'base64');
            const txBodyHex = txBodyBytes.toString('hex');
            console.log(`[GET_SCHEDULE] TxBody hex (first 100 chars): ${txBodyHex.slice(0, 100)}`);

            // Parse the protobuf to extract contract call details
            const contractInfo = this.parseContractCallFromProtobuf(txBodyHex);
            console.log(`[GET_SCHEDULE] Parsed contract info:`, contractInfo);
            
            if (!contractInfo.contractId) {
                return { 
                    decoded: false, 
                    reason: 'Not a contract call or could not parse contract info',
                    rawHex: txBodyHex.slice(0, 200) + '...' // First 200 chars for debugging
                };
            }

            // Decode using contract ID to pick ABI: LP Manager (0.0.7842637) -> VaultLPManager, else DepositMinterV2
            const decodedFunction = this.decodeFunctionCall(contractInfo.functionParameters, contractInfo.contractId);

            const result: Record<string, unknown> = {
                decoded: true,
                contractId: contractInfo.contractId,
                functionName: decodedFunction.functionName,
                parameters: decodedFunction.parameters,
                amount: contractInfo.amount,
                gas: contractInfo.gas,
                rawFunctionParams: contractInfo.functionParameters
            };
            if ('contractHint' in decodedFunction && decodedFunction.contractHint) {
                result.contractHint = decodedFunction.contractHint;
            }
            return result;

        } catch (error) {
            return { 
                decoded: false, 
                error: error instanceof Error ? error.message : 'Unknown decode error' 
            };
        }
    }

    private parseContractCallFromProtobuf(txBodyHex: string): {
        contractId: string | null;
        functionParameters: string;
        amount: string | null;
        gas: number | null;
    } {
        try {
            // In Hedera protobuf, the schedule transaction body contains:
            // Field 3 (0x1A): scheduledTransactionBody (the actual transaction to execute)
            // Inside that is a ContractExecuteTransaction with:
            //   - Field 1: contractID
            //   - Field 2: gas (varint)
            //   - Field 3: amount (varint, in tinybars)
            //   - Field 4: functionParameters (bytes)
            
            // Look for field 3 (scheduledTransactionBody) - wire type 2 (length-delimited)
            // Field 3 = 0x1A in protobuf (field 3 << 3 | wire_type 2)
            const contractCallMarker = '1a';
            const markerIndex = txBodyHex.indexOf(contractCallMarker);
            console.log(`[GET_SCHEDULE] Looking for marker '1a', found at index: ${markerIndex}`);
            
            if (markerIndex === -1) {
                console.log('[GET_SCHEDULE] Marker not found - not a scheduled contract call');
                return { contractId: null, functionParameters: '', amount: null, gas: null };
            }

            // Read the length varint after the field marker
            let offset = markerIndex + 2;
            const lengthBytes = this.readVarint(txBodyHex, offset);
            offset += lengthBytes.bytesRead * 2;

            // Now we're inside the contractCall message
            // Extract the nested fields
            let contractId: string | null = null;
            let gas: number | null = null;
            let amount: string | null = null;
            let functionParameters = '';

            const contractCallEnd = offset + (lengthBytes.value * 2);
            
            while (offset < contractCallEnd && offset < txBodyHex.length) {
                const fieldTag = txBodyHex.slice(offset, offset + 2);
                offset += 2;

                if (fieldTag === '0a') { // Field 1: contractID (length-delimited)
                    const idLengthBytes = this.readVarint(txBodyHex, offset);
                    offset += idLengthBytes.bytesRead * 2;
                    
                    // Read contract ID bytes
                    const contractIdBytes = txBodyHex.slice(offset, offset + idLengthBytes.value * 2);
                    offset += idLengthBytes.value * 2;
                    
                    // Parse contract ID (shard.realm.num format in protobuf)
                    const parsed = this.parseAccountIdFromProtobuf(contractIdBytes);
                    contractId = parsed;
                    
                } else if (fieldTag === '10') { // Field 2: gas (varint)
                    const gasBytes = this.readVarint(txBodyHex, offset);
                    gas = gasBytes.value;
                    offset += gasBytes.bytesRead * 2;
                    
                } else if (fieldTag === '18') { // Field 3: amount (varint)
                    const amountBytes = this.readVarint(txBodyHex, offset);
                    amount = amountBytes.value.toString();
                    offset += amountBytes.bytesRead * 2;
                    
                } else if (fieldTag === '22') { // Field 4: functionParameters (bytes)
                    const paramsLengthBytes = this.readVarint(txBodyHex, offset);
                    offset += paramsLengthBytes.bytesRead * 2;
                    
                    functionParameters = txBodyHex.slice(offset, offset + paramsLengthBytes.value * 2);
                    offset += paramsLengthBytes.value * 2;
                } else {
                    // Skip unknown field
                    offset += 2;
                }
            }

            return { contractId, functionParameters, amount, gas };
            
        } catch (error) {
            console.error('[GET_SCHEDULE] Error parsing protobuf:', error);
            return { contractId: null, functionParameters: '', amount: null, gas: null };
        }
    }

    private readVarint(hex: string, offset: number): { value: number; bytesRead: number } {
        let value = 0;
        let shift = 0;
        let bytesRead = 0;
        
        while (offset < hex.length) {
            const byte = parseInt(hex.slice(offset, offset + 2), 16);
            offset += 2;
            bytesRead++;
            
            value |= (byte & 0x7f) << shift;
            
            if ((byte & 0x80) === 0) {
                break;
            }
            
            shift += 7;
            
            if (bytesRead > 10) {
                break; // Safety limit
            }
        }
        
        return { value, bytesRead };
    }

    private parseAccountIdFromProtobuf(hex: string): string {
        // Account ID in protobuf has: shard (varint), realm (varint), num (varint)
        // Usually 0.0.xxxx so we mostly care about the num
        let offset = 0;
        let shard = 0;
        let realm = 0;
        let num = 0;
        
        // Read each field (simple case: all three are present as varints with field tags)
        while (offset < hex.length) {
            const tag = hex.slice(offset, offset + 2);
            offset += 2;
            
            if (tag === '08') { // Field 1: shard
                const shardBytes = this.readVarint(hex, offset);
                shard = shardBytes.value;
                offset += shardBytes.bytesRead * 2;
            } else if (tag === '10') { // Field 2: realm  
                const realmBytes = this.readVarint(hex, offset);
                realm = realmBytes.value;
                offset += realmBytes.bytesRead * 2;
            } else if (tag === '18') { // Field 3: num
                const numBytes = this.readVarint(hex, offset);
                num = numBytes.value;
                offset += numBytes.bytesRead * 2;
            } else {
                offset += 2;
            }
        }
        
        return `${shard}.${realm}.${num}`;
    }

    /** Recursively convert BigInt to string so JSON.stringify works. */
    private serializeForJson(value: unknown): unknown {
        if (typeof value === 'bigint') return value.toString();
        if (Array.isArray(value)) return value.map((v) => this.serializeForJson(v));
        if (value !== null && typeof value === 'object') {
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(value)) {
                out[k] = this.serializeForJson(v);
            }
            return out;
        }
        return value;
    }

    private decodeFunctionCall(functionParamsHex: string, contractId?: string | null): { functionName: string; parameters: any; contractHint?: string } {
        try {
            const cleanHex = functionParamsHex.startsWith('0x') ? functionParamsHex.slice(2) : functionParamsHex;
            const data = '0x' + cleanHex;

            // Both contracts have createLPPosition (same selector). Use contract ID to pick ABI.
            const lpManagerIds = (process.env.LYNX_LP_MANAGER_CONTRACT || '0.0.7842637').split(',').map((s) => s.trim());
            const isLpManager = contractId && lpManagerIds.includes(contractId);

            const abis: { name: string; abi: any[] }[] = isLpManager
                ? [
                    { name: 'VaultLPManager', abi: this.vaultLPManagerAbi },
                    { name: 'DepositMinterV2', abi: this.depositMinterAbi },
                ]
                : [
                    { name: 'DepositMinterV2', abi: this.depositMinterAbi },
                    { name: 'VaultLPManager', abi: this.vaultLPManagerAbi },
                ];

            for (const { name, abi } of abis) {
                if (abi.length === 0) continue;
                try {
                    const iface = new ethers.Interface(abi);
                    const decoded = iface.parseTransaction({ data });
                    if (decoded) {
                        const params: Record<string, unknown> = {};
                        decoded.fragment.inputs.forEach((input, index) => {
                            const value = decoded.args[index];
                            params[input.name || `param${index}`] = this.serializeForJson(value);
                        });
                        return { functionName: decoded.name, parameters: params, contractHint: name };
                    }
                } catch {
                    continue;
                }
            }

            // Fallback: known selectors not in compiled ABIs (e.g. setAdmin from proxy/admin contracts)
            const selector = cleanHex.slice(0, 8);
            if (selector === '704b6c02') {
                // setAdmin(address) - both DepositMinterV2 and VaultLPManager have this
                try {
                    const setAdminAbi = ['function setAdmin(address newAdmin)'];
                    const iface = new ethers.Interface(setAdminAbi);
                    const decoded = iface.parseTransaction({ data });
                    if (decoded) {
                        const params: Record<string, unknown> = {};
                        decoded.fragment.inputs.forEach((input, index) => {
                            const value = decoded.args[index];
                            params[input.name || `param${index}`] = this.serializeForJson(value);
                        });
                        return { functionName: 'setAdmin', parameters: params, contractHint: 'DepositMinterV2/VaultLPManager' };
                    }
                } catch {
                    // fall through to Unknown
                }
            }

            return {
                functionName: 'Unknown',
                parameters: { rawHex: functionParamsHex }
            };

        } catch (error) {
            console.error('[GET_SCHEDULE] Error decoding function:', error);
            return {
                functionName: 'Decode Error',
                parameters: { 
                    error: error instanceof Error ? error.message : 'Unknown error',
                    rawHex: functionParamsHex 
                }
            };
        }
    }
}

