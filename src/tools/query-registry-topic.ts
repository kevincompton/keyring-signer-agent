import { z } from 'zod';
import { StructuredTool } from '@langchain/core/tools';

/**
 * Tool to query the project registry topic directly via mirror node REST API
 * This bypasses the agent-kit tool that seems to be failing
 */
export class QueryRegistryTopicTool extends StructuredTool {
    name = 'query_registry_topic';
    description = 'Query the project registry topic to get operator account IDs. Returns the actual messages from the topic.';
    
    schema = z.object({
        topicId: z.string().describe('The project registry topic ID to query for registered projects'),
    });

    private mirrorNodeUrl: string;

    constructor(network: string = 'testnet') {
        super();
        this.mirrorNodeUrl = network === 'mainnet' 
            ? 'https://mainnet-public.mirrornode.hedera.com'
            : 'https://testnet.mirrornode.hedera.com';
    }

    async _call(input: z.infer<typeof this.schema>): Promise<string> {
        const { topicId } = input;
        
        try {
            const url = `${this.mirrorNodeUrl}/api/v1/topics/${topicId}/messages?limit=10&order=desc`;
            console.log(`   🔍 Querying mirror node: ${url}`);
            
            const response = await fetch(url);
            
            if (!response.ok) {
                return `Error querying topic: ${response.status} ${response.statusText}`;
            }
            
            const data = await response.json();
            
            if (!data.messages || data.messages.length === 0) {
                return `No messages found in topic ${topicId}. The topic may be empty or the topic ID may be incorrect.`;
            }
            
            console.log(`   ✅ Found ${data.messages.length} messages in topic`);
            
            // Decode and parse messages
            const messages = data.messages.map((msg: any) => {
                try {
                    // Decode base64 message
                    const decoded = Buffer.from(msg.message, 'base64').toString('utf-8');
                    
                    // Try to parse as JSON
                    let parsed;
                    try {
                        parsed = JSON.parse(decoded);
                    } catch {
                        parsed = decoded;
                    }
                    
                    return {
                        sequence: msg.sequence_number,
                        timestamp: msg.consensus_timestamp,
                        content: parsed,
                        raw: decoded
                    };
                } catch (error) {
                    return {
                        sequence: msg.sequence_number,
                        timestamp: msg.consensus_timestamp,
                        error: 'Failed to decode message',
                        raw: msg.message
                    };
                }
            });
            
            return JSON.stringify({
                topic: topicId,
                messageCount: messages.length,
                messages: messages
            }, null, 2);
            
        } catch (error: any) {
            console.error(`   ❌ Error querying topic:`, error);
            return `Failed to query topic ${topicId}: ${error.message}`;
        }
    }
}

