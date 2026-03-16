import { config } from 'dotenv';
import { Client, TopicMessageQuery, TopicMessageSubmitTransaction, TopicId } from '@hashgraph/sdk';
import { EnvironmentConfig } from './agent-config.js';
import { HederaLangchainToolkit, AgentMode, coreAccountPlugin, coreConsensusPlugin, coreConsensusQueryPlugin } from 'hedera-agent-kit';
import { createAgent } from 'langchain';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage } from '@langchain/core/messages';
import { readFileSync } from 'fs';
import { join } from 'path';
import { FetchPendingTransactionsTool } from '../tools/fetch-pending-transactions.js';
import { SignTransactionTool } from '../tools/sign-transaction.js';
import { QueryRegistryTopicTool } from '../tools/query-registry-topic.js';
import { GetScheduleInfoTool } from '../tools/get-schedule-info.js';
import { SchedulePassiveAgentsTool } from '../tools/schedule-passive-agents.js';

// Load environment variables
config();

/** Extract final text output from LangChain 1.x agent invoke result */
function getAgentOutput(result: { messages?: unknown[] }): string {
    const messages = result?.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg instanceof AIMessage) {
            const c = msg.content;
            if (typeof c === 'string') return c;
            if (Array.isArray(c)) {
                return c.map((b: { type?: string; text?: string }) => b?.text ?? '').join('');
            }
        }
        const m = msg as { _getType?: () => string; content?: string | unknown[] };
        if (m && m._getType?.() === 'ai' && typeof m.content === 'string') return m.content;
    }
    return '';
}

export class KeyringSignerAgent {
    private env!: EnvironmentConfig;
    private isRunning: boolean = false;

    // Blockchain tools
    private hederaAgentToolkit?: HederaLangchainToolkit;
    private agent?: ReturnType<typeof createAgent>;
    private client?: Client;
    private signTransactionTool?: SignTransactionTool;

    // State for pending transactions
    private pendingScheduleIds: string[] = [];
    private lynxOperatorId: string = '';

    // Validator inbound subscription
    private isRunningCheck: boolean = false;
    private runCheckAgain: boolean = false;

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
                model: "gpt-5-nano",
                temperature: 0,
                configuration: {
                    baseURL: "https://ai-gateway.vercel.sh/v1",
                },
                apiKey: process.env.AI_GATEWAY_API_KEY!,
                maxRetries: 5,
                timeout: 90000,
            });

            const systemPrompt = `You are an autonomous Keyring Signer Agent for the Hedera blockchain. Your role is to act as a threshold signature key holder for project accounts.

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
1. SCHEDULE EXPIRY: Schedules with less than 48 hours until expiry (check schedule.secondsUntilExpiry from get_schedule_info — must be >= 172800). This ensures signers have enough time. NOTE: This rule does NOT apply to schedules from the operator inbound topic (those are trusted and signed directly).
2. updateRatios/adminUpdateRatios with invalid parameters:
   - ANY ratio value < 1 or > 100 (violates MIN_RATIO/MAX_RATIO constraints)
   - Extremely imbalanced ratios (e.g., hbarRatio > 95 or any single asset > 95%)
   - All ratios set to maximum (100) - economic attack vector
3. setGovernanceAddress:
   - Setting to zero address (0x0000000000000000000000000000000000000000)
   - Setting to unexpected/unknown addresses without governance approval
4. Unknown or unexpected function calls not in the DepositMinterV2 or VaultLPManager ABI
5. Calls to admin-only functions from non-admin addresses

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

VALIDATION RULES FOR VAULTLP MANAGER (VaultLPManager) - LP staking / SaucerSwap:

The threshold account (this agent signs for it) IS the admin for Lynx contracts. Admin operations and transfers between LP manager and vault are normal when the threshold schedules them — no special approval needed.

CRITICAL RISK - MUST REJECT:
1. Unknown function calls not in either DepositMinterV2 or VaultLPManager ABI

LOW RISK - LIKELY SAFE TO SIGN (all known VaultLPManager functions when threshold is payer):
- LP operations: createLPPosition, closeLPPosition, decreaseLPPosition, collectLPFees
- V1 liquidity: addLiquidityV1, addLiquidityV1ETH, removeLiquidityV1, removeLiquidityV1ETH
- Admin/config: setVault, setAdmin, configureSaucerSwap, configureSaucerSwapV1, setCompositionToken, associateTokenAdmin, approveSaucerSwapSpending, approveSaucerSwapV1Spending, associateSaucerSwapTokens
- Transfers: withdrawToVault, withdrawHbarToVault - moving tokens/HBAR between LP manager and proxy (vault) is normal admin operation

setAdmin(address newAdmin): When memo indicates admin action (e.g. "Lynx: setAdmin 0.0.xxxxx on 0.0.yyyyy") and threshold is payer, treat as LOW RISK. REJECT only if newAdmin is zero address (0x0000000000000000000000000000000000000000).

When contractHint is "VaultLPManager" or "DepositMinterV2/VaultLPManager", treat as LOW RISK unless parameters look suspicious (e.g. zero address for setVault or setAdmin). Note: tickLower and tickUpper (int24) can be negative — that is normal for concentrated liquidity, not a red flag.

WORKFLOW:
- Use your scratchpad to remember information across steps (operator IDs, pending transactions, contract details)
- Process transactions systematically and thoroughly
- For EACH transaction (from fetch_pending_transactions — NOT from operator topic):
  1. Get full details via get_schedule_info (includes expirationTime, secondsUntilExpiry, secondsUntilOneHourBeforeExpiry)
  2. MUST REJECT if secondsUntilExpiry < 172800 (48 hours) — signers need time
  3. Analyze against the validation rules above
  4. Determine risk level (low/medium/high/critical)
  5. Post validation message to validator topic
  6. If high/critical: Post rejection to rejection topic and DO NOT SIGN
  7. If low/medium: Sign the transaction, then IMMEDIATELY call schedule_passive_agents with scheduleId and durationSeconds = schedule.secondsUntilOneHourBeforeExpiry (schedules review to execute 1 hour before expiry)
- Maintain detailed logs of all decisions
- Format rejection messages in HCS2 JSON standard

TOOLS AT YOUR DISPOSAL:
- GET_TOPIC_MESSAGES_QUERY_TOOL: Load messages from HCS topics
- fetch_pending_transactions: Query pending scheduled transactions
- get_schedule_info: Get decoded transaction details including function name and parameters
- sign_transaction: Sign approved transactions
- schedule_passive_agents: After signing an approved schedule (from pending transactions), call this to schedule passive agents — use scheduleId and durationSeconds = secondsUntilOneHourBeforeExpiry from get_schedule_info (executes 1 hour before expiry)
- SUBMIT_TOPIC_MESSAGE_TOOL: Post validation/rejection messages to HCS topics

IMPORTANT: Hedera scheduled transactions are immutable — they cannot be deleted. Do not attempt to delete schedules. For invalid or unwanted schedules, post a rejection and do not sign; the schedule will expire if not executed.

You are account ${this.env.HEDERA_ACCOUNT_ID} operating on ${this.env.HEDERA_NETWORK || 'testnet'}.`;

            // Exclude schedule_delete_tool: Hedera schedules are immutable and cannot be deleted
            const hederaTools = this.hederaAgentToolkit.getTools().filter(
                (t: { name?: string }) => t.name !== 'schedule_delete_tool'
            );
            const fetchPendingTransactionsTool = new FetchPendingTransactionsTool(this.client);
            this.signTransactionTool = new SignTransactionTool(this.client);
            const queryRegistryTool = new QueryRegistryTopicTool(this.env.HEDERA_NETWORK || 'testnet');
            const getScheduleInfoTool = new GetScheduleInfoTool(this.client);
            const schedulePassiveAgentsTool = new SchedulePassiveAgentsTool();
            const allTools = [...hederaTools, fetchPendingTransactionsTool, this.signTransactionTool, queryRegistryTool, getScheduleInfoTool, schedulePassiveAgentsTool];

            this.agent = createAgent({
                model: llm,
                tools: allTools as any, // Hedera toolkit tools are compatible at runtime
                systemPrompt,
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
            await this.runCheck();

            const validatorInboundTopicId = this.env.PROJECT_VALIDATOR_INBOUND_TOPIC;
            if (validatorInboundTopicId && validatorInboundTopicId !== '0.0.0' && this.client) {
                console.log(`\n📥 Subscribing to validator inbound topic: ${validatorInboundTopicId}`);
                console.log('   (Message received = trigger check)\n');
                this.subscribeToValidatorInbound(validatorInboundTopicId);
            }

            const operatorInboundTopicId = this.env.KEYRING_OPERATOR_INBOUND_TOPIC_ID;
            if (operatorInboundTopicId && operatorInboundTopicId !== '0.0.0' && this.client) {
                console.log(`\n📥 Subscribing to operator inbound topic: ${operatorInboundTopicId}`);
                console.log('   (KeyRing operator sends schedule IDs to sign)\n');
                this.subscribeToOperatorInbound(operatorInboundTopicId);
            }

            if (!validatorInboundTopicId && !operatorInboundTopicId) {
                console.log('\n✅ Initial check complete. No inbound topics configured for subscription.');
            }
        } catch (error) {
            console.error("❌ Error starting keyring signer agent:", error);
            throw error;
        }
    }

    /** Runs fetch + review. Used on startup and when validator inbound message received. */
    private async runCheck(): Promise<void> {
        if (this.isRunningCheck) {
            this.runCheckAgain = true;
            return;
        }
        this.isRunningCheck = true;
        this.runCheckAgain = false;
        try {
            await this.fetchPendingTransactions();
            await this.reviewAllPendingTransactions();
        } finally {
            this.isRunningCheck = false;
            if (this.runCheckAgain && this.isRunning) {
                console.log('\n📥 Triggered by inbound message, running check again...');
                await this.runCheck();
            }
        }
    }

    private subscribeToValidatorInbound(topicId: string): void {
        if (!this.client) {
            throw new Error('Client not initialized');
        }
        new TopicMessageQuery()
            .setTopicId(topicId)
            .subscribe(this.client, (msg, err) => {
                if (err) {
                    console.error('❌ Validator inbound subscription error:', err);
                }
            }, (message) => {
                const messageAsString = new TextDecoder().decode(message.contents);
                console.log(
                    `\n📥 ${message.consensusTimestamp.toDate().toISOString()} Validator inbound message received: ${messageAsString}`
                );
                this.runCheck().catch((err) => {
                    console.error('❌ Error running check from inbound trigger:', err);
                });
            });
    }

    /** Subscribe to operator inbound topic. KeyRing operator sends schedule IDs to sign (trusted, no validation). */
    private subscribeToOperatorInbound(topicId: string): void {
        if (!this.client || !this.signTransactionTool) {
            throw new Error('Client or signTransactionTool not initialized');
        }
        new TopicMessageQuery()
            .setTopicId(topicId)
            .subscribe(this.client, (msg, err) => {
                if (err) {
                    console.error('❌ Operator inbound subscription error:', err);
                }
            }, (message) => {
                const messageAsString = new TextDecoder().decode(message.contents);
                console.log(
                    `\n📥 ${message.consensusTimestamp.toDate().toISOString()} Operator inbound message received: ${messageAsString}`
                );
                this.handleOperatorInboundMessage(messageAsString).catch((err) => {
                    console.error('❌ Error handling operator inbound message:', err);
                });
            });
    }

    /** Parse schedule IDs from message, sign each, notify passive agents. */
    private async handleOperatorInboundMessage(message: string): Promise<void> {
        const scheduleIdPattern = /0\.0\.\d+/g;
        const scheduleIds = [...new Set(message.match(scheduleIdPattern) ?? [])];
        if (scheduleIds.length === 0) {
            console.log('[OPERATOR_INBOUND] No schedule IDs found in message');
            return;
        }
        console.log(`[OPERATOR_INBOUND] Signing ${scheduleIds.length} schedule(s) from KeyRing operator:`, scheduleIds);
        for (const scheduleId of scheduleIds) {
            try {
                const result = await this.signTransactionTool!._call({ scheduleId });
                const parsed = JSON.parse(result) as { success?: boolean; error?: string };
                if (parsed.success) {
                    console.log(`[OPERATOR_INBOUND] Signed ${scheduleId}`);
                    await this.notifyPassiveAgents(scheduleId);
                } else {
                    console.log(`[OPERATOR_INBOUND] Could not sign ${scheduleId}: ${parsed.error ?? result}`);
                }
            } catch (err) {
                console.error(`[OPERATOR_INBOUND] Error signing ${scheduleId}:`, err);
            }
            await new Promise((r) => setTimeout(r, 1000)); // Rate limit
        }
    }

    /** Post schedule ID to passive agent inbound topics. */
    private async notifyPassiveAgents(scheduleId: string): Promise<void> {
        const passiveTopics = process.env.PASSIVE_AGENT_INBOUND_TOPICS?.split(',').map((t) => t.trim()).filter(Boolean) ?? [];
        if (passiveTopics.length === 0) return;
        if (!this.client) return;
        for (const topicIdStr of passiveTopics) {
            try {
                const tx = await new TopicMessageSubmitTransaction()
                    .setTopicId(TopicId.fromString(topicIdStr))
                    .setMessage(scheduleId)
                    .execute(this.client);
                await tx.getReceipt(this.client);
                console.log(`[OPERATOR_INBOUND] Notified passive agent topic ${topicIdStr}`);
            } catch (err) {
                console.error(`[OPERATOR_INBOUND] Failed to notify ${topicIdStr}:`, err);
            }
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
            
            const result = await this.agent?.invoke({
                messages: [{ role: "human", content: `Use the query_registry_topic tool to query topic ${this.env.PROJECT_REGISTRY_TOPIC}.

Extract the "operatorAccountId" field from the metadata in the returned message.

Return ONLY the operator account ID in format 0.0.xxxxx` }],
            }, { configurable: { thread_id: "keyring-signer" } });

            const output = getAgentOutput(result ?? {});
            console.log("✅ Project details loaded:", output);

            const operatorMatch = output?.match(/0\.0\.\d+/);
            if (operatorMatch) {
                this.lynxOperatorId = operatorMatch[0];
                console.log(`📝 Lynx Operator ID: ${this.lynxOperatorId}`);
            } else {
                throw new Error('Could not extract operator ID from registry');
            }
            
            // Small delay after AI operation
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.error("❌ Error loading project details:", error);
            throw error;
        }
    }

    private async loadContractDetails(): Promise<void> {
        try {
            const lynxToken = readFileSync(join(process.cwd(), 'src/projects/contracts/LynxToken.sol'), 'utf-8');
            const depositMinter = readFileSync(join(process.cwd(), 'src/projects/contracts/DepositMinterV2.sol'), 'utf-8');
            const vaultLPManager = readFileSync(join(process.cwd(), 'src/projects/contracts/VaultLPManager.sol'), 'utf-8');
            
            const result = await this.agent?.invoke({
                messages: [{ role: "human", content: `Review these Hedera smart contracts:\n\nLynxToken:\n${lynxToken}\n\nDepositMinterV2:\n${depositMinter}\n\nVaultLPManager:\n${vaultLPManager}\n\nSave them in memory. Lynx uses DepositMinterV2 for minting and VaultLPManager for LP staking (createLPPosition, closeLPPosition, etc.). Respond with contract and ABI loaded boolean.` }],
            }, { configurable: { thread_id: "keyring-signer" } });
            console.log("✅ Contract review:", getAgentOutput(result ?? {}));
            
            // Small delay after AI operation
            await new Promise(resolve => setTimeout(resolve, 1000));
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
            
            const result = await this.agent?.invoke({
                messages: [{ role: "human", content: `Use the fetch_pending_transactions tool with projectOperatorAccountId="${this.lynxOperatorId}".

Return ONLY a JSON array of schedule IDs.` }],
            }, { configurable: { thread_id: "keyring-signer" } });

            const output = getAgentOutput(result ?? {});
            console.log("✅ Pending transactions fetched:", output);

            await new Promise(resolve => setTimeout(resolve, 1000));
            
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
            
            for (let i = 0; i < this.pendingScheduleIds.length; i++) {
                const scheduleId = this.pendingScheduleIds[i];
                
                try {
                    await this.reviewPendingTransaction(scheduleId);
                    
                    // Add delay between transactions to avoid rate limits
                    if (i < this.pendingScheduleIds.length - 1) {
                        console.log("⏱️  Waiting 3 seconds before next transaction review (rate limit prevention)...");
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                } catch (error) {
                    console.error(`❌ Error reviewing transaction ${scheduleId}:`, error);
                    
                    // If rate limited, wait longer before continuing
                    if (error instanceof Error && error.message.includes('429')) {
                        console.log("⚠️  Rate limit detected. Waiting 60 seconds before continuing...");
                        await new Promise(resolve => setTimeout(resolve, 60000));
                    }
                    
                    // Continue with other transactions even if one fails
                    continue;
                }
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

            const result = await this.agent?.invoke({
                messages: [{ role: "human", content: `Review scheduled transaction ${scheduleId}:

STEP 1: Get full transaction details
- Use get_schedule_info tool to get details for scheduleId="${scheduleId}"
- This returns decoded function name, parameters, expirationTime, secondsUntilExpiry, and secondsUntilOneHourBeforeExpiry

STEP 2: Check 48-hour expiry rule (MUST REJECT if violated)
- If schedule.secondsUntilExpiry < 172800 (48 hours): Post rejection to ${this.env.PROJECT_REJECTION_TOPIC} with reason "Schedule expires in less than 48 hours — signers need adequate time". DO NOT sign.
- If no expirationTime or secondsUntilExpiry: treat as invalid, reject.

STEP 3: Analyze the transaction
- Check the function name and parameters against the validation rules in your system prompt
- If contractHint is "VaultLPManager": use VaultLPManager rules (createLPPosition, closeLPPosition, etc. are LOW RISK)
- If DepositMinterV2: compare parameters to DepositMinterV2 constraints (ratios, deposits)
- Identify any red flags (invalid ratios, zero addresses, insufficient deposits, admin functions, etc.)
- Determine risk level: low, medium, high, or critical

STEP 4: Post validation message
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

STEP 5: Take action based on risk
- If LOW or MEDIUM risk: 
  1. Use sign_transaction tool with scheduleId="${scheduleId}"
  2. IMMEDIATELY after successful sign: if schedule.secondsUntilOneHourBeforeExpiry > 0, call schedule_passive_agents with scheduleId="${scheduleId}" and durationSeconds = schedule.secondsUntilOneHourBeforeExpiry. This schedules the review to execute 1 hour before expiry.
- If HIGH or CRITICAL risk:
  * Post rejection to topic ${this.env.PROJECT_REJECTION_TOPIC}. Include schedule_id and signer (${this.env.HEDERA_ACCOUNT_ID}) in the message so this agent can filter them on future fetches.
  * DO NOT sign the transaction
  * Report that transaction was rejected

Report the final action taken (signed or rejected) and why.` }],
            }, { configurable: { thread_id: "keyring-signer" } });

            console.log(`✅ Transaction ${scheduleId} review complete:`, getAgentOutput(result ?? {}));
        } catch (error) {
            console.error(`❌ Error reviewing transaction ${scheduleId}:`, error);
            throw error;
        }
    }
    
}