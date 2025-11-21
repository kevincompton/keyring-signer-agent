import { config } from 'dotenv';
import { Client } from '@hashgraph/sdk';
import { EnvironmentConfig } from './agent-config.js';
import { HederaLangchainToolkit, AgentMode, coreAccountPlugin, coreConsensusPlugin, coreConsensusQueryPlugin } from 'hedera-agent-kit';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { readFileSync } from 'fs';
import { join } from 'path';
import { FetchPendingTransactionsTool } from '../tools/fetch-pending-transactions.js';
import { SignTransactionTool } from '../tools/sign-transaction.js';
import { QueryRegistryTopicTool } from '../tools/query-registry-topic.js';
import { GetScheduleInfoTool } from '../tools/get-schedule-info.js';

// Load environment variables
config();

export class KeyringSignerAgent {
    private env!: EnvironmentConfig;
    private isRunning: boolean = false;

    // Blockchain tools
    private hederaAgentToolkit?: HederaLangchainToolkit;
    private agentExecutor?: AgentExecutor;
    private client?: Client;

    // State for pending transactions
    private pendingScheduleIds: string[] = [];
    private lynxOperatorId: string = '';

    constructor() {
        this.env = process.env as NodeJS.ProcessEnv & EnvironmentConfig;
    }

    async initialize(): Promise<void> {
        console.log("🦌⚡ Initializing Keyring Signer Agent");
        console.log("==========================================");

        // Validate required environment variables
        const requiredVars = [
            'OPENAI_API_KEY',
            'HEDERA_ACCOUNT_ID',
            'HEDERA_PRIVATE_KEY',
            'OPERATOR_PUBLIC_KEY',
            'PROJECT_REGISTRY_TOPIC',
            'PROJECT_CONTRACTS_TOPIC',
            'PROJECT_AUDIT_TOPIC',
            'PROJECT_REJECTION_TOPIC',
            'PROJECT_VALIDATOR_TOPIC'
        ];

        const missingVars = requiredVars.filter(varName => !this.env[varName]);
        if (missingVars.length > 0) {
            throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
        }

        try {
            // Initialize blockchain tools
            await this.initializeBlockchainTools();
      
            console.log("✅ Keyring Signer Agent initialized successfully");
            console.log(`📋 Account ID: ${this.env.HEDERA_ACCOUNT_ID}`);
            console.log(`🌐 Network: ${this.env.HEDERA_NETWORK || 'testnet'}`);
      
        } catch (error) {
            console.error("❌ Failed to initialize keyring signer agent:", error);
            throw error;
        }
    }

    private async initializeBlockchainTools(): Promise<void> {
        console.log("🔧 Initializing blockchain tools for keyring signer agent...");
      
        try {
            // Initialize Hedera Client (following tool-calling-balance-check pattern)
            this.client = Client.forTestnet();
            this.client.setOperator(this.env.HEDERA_ACCOUNT_ID!, this.env.HEDERA_PRIVATE_KEY!);

            this.hederaAgentToolkit = new HederaLangchainToolkit({
                client: this.client,
                configuration: {
                  tools: [], // empty array loads all tools
                  context: {
                    mode: AgentMode.AUTONOMOUS,
                  },
                  plugins: [coreAccountPlugin, coreConsensusPlugin, coreConsensusQueryPlugin],
                }
            });

            const llm = new ChatOpenAI({
                modelName: "gpt-4o",                // Using GPT-4o for better reasoning
                temperature: 0,                     // 0 = deterministic, 1 = creative
                configuration: {
                    baseURL: "https://ai-gateway.vercel.sh/v1",  // Vercel AI Gateway
                },
                apiKey: process.env.AI_GATEWAY_API_KEY!,         // Your Vercel AI Gateway key
            });

            const prompt = ChatPromptTemplate.fromMessages([
                ["system", `You are an autonomous Keyring Signer Agent for the Hedera blockchain. Your role is to act as a threshold signature key holder for project accounts.

RESPONSIBILITIES:
1. Load and understand project configurations from HCS (Hedera Consensus Service) registry topics
2. Review and validate smart contract ABIs to understand expected transaction patterns
3. Monitor for pending scheduled transactions that require your signature
4. Autonomously validate transactions against known contract patterns and security requirements
5. Sign valid transactions that match expected behavior
6. Reject and report suspicious or invalid transactions to audit topics

SECURITY PRINCIPLES:
- Always validate transaction parameters against the loaded contract ABIs
- Verify transaction types match expected contract interactions
- Check for unexpected or malicious parameters
- Never sign transactions that don't align with project contracts
- Document all rejections with detailed reasoning
- NEVER use placeholder or example values (like 0.0.123456) - always use the ACTUAL values from previous tool results

VALIDATION RULES FOR DEPOSITMINTER CONTRACT:

CRITICAL RISK - MUST REJECT:
1. updateRatios/adminUpdateRatios with invalid parameters:
   - ANY ratio value < 1 or > 100 (violates MIN_RATIO/MAX_RATIO constraints)
   - Extremely imbalanced ratios (e.g., hbarRatio > 95 or any single asset > 95%)
   - All ratios set to maximum (100) - economic attack vector
2. setGovernanceAddress:
   - Setting to zero address (0x0000000000000000000000000000000000000000)
   - Setting to unexpected/unknown addresses without governance approval
3. Unknown or unexpected function calls not in the contract ABI
4. Calls to admin-only functions from non-admin addresses

HIGH RISK - INVESTIGATE CAREFULLY:
1. mintWithDeposits with insufficient deposits:
   - HBAR amount much lower than expected (< 5 HBAR for 1 LYNX)
   - Token deposits that don't match the current ratios
   - Suspiciously low deposit values (< 100 for token parameters)
2. Large ratio changes (> 10% swing in any single ratio)
3. adjustSupply with extreme values

MEDIUM RISK - VALIDATE THOROUGHLY:
1. updateRatios with reasonable changes (1-10% adjustments)
2. adjustSupply for supply tracking corrections
3. Standard minting operations with proper deposits

LOW RISK - LIKELY SAFE TO SIGN:
1. mintWithDeposits with correct deposit ratios matching current configuration
2. Small ratio adjustments within expected governance parameters

WORKFLOW:
- Use your scratchpad to remember information across steps (operator IDs, pending transactions, contract details)
- Process transactions systematically and thoroughly
- For EACH transaction:
  1. Get full details including decoded function name and parameters
  2. Analyze against the validation rules above
  3. Determine risk level (low/medium/high/critical)
  4. Post validation message to validator topic
  5. If high/critical: Post rejection to rejection topic and DO NOT SIGN
  6. If low/medium: Sign the transaction
- Maintain detailed logs of all decisions
- Format rejection messages in HCS2 JSON standard

TOOLS AT YOUR DISPOSAL:
- GET_TOPIC_MESSAGES_QUERY_TOOL: Load messages from HCS topics
- fetch_pending_transactions: Query pending scheduled transactions
- get_schedule_info: Get decoded transaction details including function name and parameters
- sign_transaction: Sign approved transactions
- SUBMIT_TOPIC_MESSAGE_TOOL: Post validation/rejection messages to HCS topics

You are account ${this.env.HEDERA_ACCOUNT_ID} operating on ${this.env.HEDERA_NETWORK || 'testnet'}.`],
                ["user", "{input}"],
                ["placeholder", "{agent_scratchpad}"],
            ]);

            const hederaTools = this.hederaAgentToolkit.getTools();
            
            // Add custom tools
            const fetchPendingTransactionsTool = new FetchPendingTransactionsTool(this.client);
            const signTransactionTool = new SignTransactionTool(this.client);
            const queryRegistryTool = new QueryRegistryTopicTool(this.env.HEDERA_NETWORK || 'testnet');
            const getScheduleInfoTool = new GetScheduleInfoTool(this.client);
            
            const allTools = [...hederaTools, fetchPendingTransactionsTool, signTransactionTool, queryRegistryTool, getScheduleInfoTool];
            const agent = await createToolCallingAgent({
                llm,
                tools: allTools,
                prompt
            });

            this.agentExecutor = new AgentExecutor({
                agent,
                tools: allTools,
                verbose: false,
                maxIterations: 10
            });

            console.log("✅ Blockchain tools initialized");
            console.log(`📋 Operator Account: ${this.env.HEDERA_ACCOUNT_ID}`);

        } catch (error) {
            console.error("❌ Failed to initialize blockchain tools:", error);
            throw error;
        }
    }

    async start(): Promise<void> {
        console.log("🚀 Starting Keyring Signer Agent");
        console.log("==========================================");

        this.isRunning = true;

        if (!this.isRunning) {
            this.isRunning = true;

            process.on('SIGINT', async () => {
                console.log('\n🛑 Received SIGINT. Shutting down gracefully...');
                await this.stop();
                process.exit(0);
            });
        }
        try {
            await this.loadProjectDetails();
            await this.loadContractDetails();
            await this.fetchPendingTransactions();
            await this.reviewAllPendingTransactions();
            
        } catch (error) {
            console.error("❌ Error starting keyring signer agent:", error);
            throw error;
        }
    }

    async stop(): Promise<void> {
        console.log("🛑 Stopping Keyring Signer Agent...");
        this.isRunning = false;
        console.log("✅ Keyring Signer Agent stopped");
    }

    private async loadProjectDetails(): Promise<void> {
        try {
            console.log("📋 Loading project details from registry topic...");
            console.log(`   Topic ID: ${this.env.PROJECT_REGISTRY_TOPIC}`);
            
            const result = await this.agentExecutor?.invoke({
                input: `Use the query_registry_topic tool to query topic ${this.env.PROJECT_REGISTRY_TOPIC}.
                
                Extract the "operatorAccountId" field from the metadata in the returned message.
                
                Return ONLY the operator account ID in format 0.0.xxxxx`
            });
            
            console.log("✅ Project details loaded:", result?.output);
            
            // Extract operator ID from response
            const operatorMatch = result?.output?.match(/0\.0\.\d+/);
            if (operatorMatch) {
                this.lynxOperatorId = operatorMatch[0];
                console.log(`📝 Lynx Operator ID: ${this.lynxOperatorId}`);
            } else {
                throw new Error('Could not extract operator ID from registry');
            }
        } catch (error) {
            console.error("❌ Error loading project details:", error);
            throw error;
        }
    }

    private async loadContractDetails(): Promise<void> {
        try {
            const lynxToken = readFileSync(join(process.cwd(), 'src/projects/contracts/LynxToken.sol'), 'utf-8');
            const depositMinter = readFileSync(join(process.cwd(), 'src/projects/contracts/DepositMinterV2.sol'), 'utf-8');
            
            const result = await this.agentExecutor?.invoke({
                input: `Review these Hedera smart contracts:\n\nLynxToken:\n${lynxToken}\n\nDepositMinterV2:\n${depositMinter} and save them in memory to compare to transactions later. Respond wih contract and ABI loaded boolean.`
            });
            console.log("✅ Contract review:", result?.output);
        } catch (error) {
            console.error("❌ Error loading contract details:", error);
            throw error;
        }
    }

    private async fetchPendingTransactions(): Promise<void> {
        try {
            console.log("🔍 Fetching pending transactions...");
            console.log(`📝 Using Lynx Operator ID: ${this.lynxOperatorId}`);
            
            if (!this.lynxOperatorId) {
                throw new Error('Lynx operator ID not loaded');
            }
            
            const result = await this.agentExecutor?.invoke({
                input: `Use the fetch_pending_transactions tool with projectOperatorAccountId="${this.lynxOperatorId}".
                
                Return ONLY a JSON array of schedule IDs.`
            });
            
            console.log("✅ Pending transactions fetched:", result?.output);
            
            // Parse the schedule IDs from the agent's response
            const output = result?.output || '';
            
            // Try to extract JSON array from the response
            const jsonMatch = output.match(/\[[\s\S]*?\]/);
            if (jsonMatch) {
                try {
                    const scheduleIds = JSON.parse(jsonMatch[0]);
                    if (Array.isArray(scheduleIds)) {
                        this.pendingScheduleIds = scheduleIds;
                        console.log(`📋 Stored ${this.pendingScheduleIds.length} pending schedule(s):`, this.pendingScheduleIds);
                        return;
                    }
                } catch (parseError) {
                    console.error("❌ Failed to parse schedule IDs from JSON");
                }
            }
            
            // Fallback: try to extract schedule IDs using regex
            const scheduleIdPattern = /0\.0\.\d+/g;
            const matches = output.match(scheduleIdPattern);
            if (matches && matches.length > 0) {
                this.pendingScheduleIds = Array.from(new Set(matches)); // Remove duplicates
                console.log(`📋 Stored ${this.pendingScheduleIds.length} pending schedule(s):`, this.pendingScheduleIds);
            } else {
                console.log("ℹ️ No pending transactions found");
                this.pendingScheduleIds = [];
            }
            
        } catch (error) {
            console.error("❌ Error fetching pending transactions:", error);
            throw error;
        }
    }
    

    private async reviewAllPendingTransactions(): Promise<void> {
        try {
            if (this.pendingScheduleIds.length === 0) {
                console.log("ℹ️ No pending transactions to review");
                return;
            }

            console.log(`🔍 Reviewing ${this.pendingScheduleIds.length} pending transaction(s)...`);
            
            for (const scheduleId of this.pendingScheduleIds) {
                await this.reviewPendingTransaction(scheduleId);
            }
            
            console.log("✅ All pending transactions reviewed");
        } catch (error) {
            console.error("❌ Error reviewing all pending transactions:", error);
            throw error;
        }
    }

    private async reviewPendingTransaction(scheduleId: string): Promise<void> {
        try {
            console.log(`🔍 Reviewing transaction: ${scheduleId}`);
            
            const result = await this.agentExecutor?.invoke({
                input: `Review scheduled transaction ${scheduleId}:
                
                STEP 1: Get full transaction details
                - Use get_schedule_info tool to get details for scheduleId="${scheduleId}"
                - This will return the decoded function name and all parameters
                
                STEP 2: Analyze the transaction
                - Check the function name and parameters against the validation rules in your system prompt
                - Compare parameters to the DepositMinterV2 contract constraints
                - Identify any red flags (invalid ratios, zero addresses, insufficient deposits, etc.)
                - Determine risk level: low, medium, high, or critical
                
                STEP 3: Post validation message
                - Always post to topic ${this.env.PROJECT_VALIDATOR_TOPIC} with:
                   {
                     "scheduleId": "${scheduleId}",
                     "reviewer": "${this.env.HEDERA_ACCOUNT_ID}",
                     "functionName": "<actual function from get_schedule_info>",
                     "reviewDescription": "<detailed analysis of why safe or dangerous>",
                     "riskLevel": "<low|medium|high|critical>",
                     "timestamp": "<ISO timestamp>",
                     "projectRegistrationTxId": "${this.env.LYNX_REGISTRATION_TX}"
                   }
                
                STEP 4: Take action based on risk
                - If LOW or MEDIUM risk: Use sign_transaction tool with scheduleId="${scheduleId}"
                - If HIGH or CRITICAL risk: 
                  * Post detailed rejection to topic ${this.env.PROJECT_REJECTION_TOPIC} explaining the security issue
                  * DO NOT sign the transaction
                  * Report that transaction was rejected
                
                Report the final action taken (signed or rejected) and why.`
            });
            
            console.log(`✅ Transaction ${scheduleId} review complete:`, result?.output);
        } catch (error) {
            console.error(`❌ Error reviewing transaction ${scheduleId}:`, error);
            throw error;
        }
    }
    
}