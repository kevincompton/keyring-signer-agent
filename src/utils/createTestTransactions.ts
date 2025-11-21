import {
    Client,
    AccountId,
    PrivateKey,
    ScheduleCreateTransaction,
    ContractExecuteTransaction,
    TransferTransaction,
    Hbar,
    ContractId,
} from '@hashgraph/sdk';
import * as dotenv from 'dotenv';
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

/**
 * Utility script to create test/example scheduled transactions for the Keyring Signer Agent.
 * 
 * This script creates a variety of transactions against the Lynx DepositMinterV2 contract
 * to test different scenarios:
 * 
 * TEST TRANSACTIONS:
 * 1. Normal minting with correct deposit amounts
 * 2. Governance ratio update within valid bounds
 * 3. Admin supply adjustment
 * 4. Invalid ratio update (out of bounds < 1 or > 100)
 * 5. Unauthorized admin action (non-admin calling admin function)
 * 6. Excessive ratio update (suspiciously high values)
 * 7. Unexpected function call to contract
 */

interface TestScenario {
    name: string;
    description: string;
    expectedRisk: 'low' | 'medium' | 'high' | 'critical';
    createTransaction: () => Promise<string>;
}

class TestTransactionCreator {
    private client: Client;
    private operatorId: AccountId;
    private operatorKey: PrivateKey;
    private thresholdAccountId: AccountId;
    private depositMinterAddress: ContractId;
    private depositMinterAbi: any;

    constructor() {
        // Initialize Hedera client
        const network = process.env.HEDERA_NETWORK || 'testnet';
        
        if (!process.env.LYNX_TESTNET_OPERATOR_ID || !process.env.LYNX_TESTNET_OPERATOR_KEY) {
            throw new Error('Missing required environment variables: LYNX_TESTNET_OPERATOR_ID, LYNX_TESTNET_OPERATOR_KEY');
        }

        if (!process.env.THRESHOLD_ACCOUNT_ID) {
            throw new Error('Missing required environment variable: THRESHOLD_ACCOUNT_ID');
        }

        if (!process.env.LYNX_TESTNET_CONTRACT) {
            throw new Error('Missing required environment variable: LYNX_TESTNET_CONTRACT');
        }

        this.operatorId = AccountId.fromString(process.env.LYNX_TESTNET_OPERATOR_ID);
        this.operatorKey = PrivateKey.fromStringED25519(process.env.LYNX_TESTNET_OPERATOR_KEY);
        this.thresholdAccountId = AccountId.fromString(process.env.THRESHOLD_ACCOUNT_ID);

        if (network === 'mainnet') {
            this.client = Client.forMainnet();
        } else {
            this.client = Client.forTestnet();
        }

        this.client.setOperator(this.operatorId, this.operatorKey);

        // Contract address
        this.depositMinterAddress = ContractId.fromString(process.env.LYNX_TESTNET_CONTRACT);

        // Load ABI
        const abiPath = path.join(__dirname, '../projects/abi/DepositMinterV2.json');
        this.depositMinterAbi = JSON.parse(fs.readFileSync(abiPath, 'utf-8')).abi;
    }

    /**
     * Helper to encode contract function calls
     */
    private encodeFunctionCall(functionName: string, params: any[]): Uint8Array {
        const iface = new ethers.Interface(this.depositMinterAbi);
        const encoded = iface.encodeFunctionData(functionName, params);
        return Buffer.from(encoded.slice(2), 'hex');
    }

    /**
     * SCENARIO 1: Standard minting transaction
     */
    private async createValidMintTransaction(): Promise<string> {
        // Mint 1 LYNX token with proper deposit amounts
        const lynxAmount = 1; // 1 LYNX
        const wbtcAmount = 100000; // 0.001 WBTC (8 decimals)
        const usdcAmount = 300000; // 0.3 USDC (6 decimals)
        const wethAmount = 100000; // 0.001 WETH (8 decimals)
        const xsauceAmount = 900000; // 0.9 XSAUCE (6 decimals)

        const functionCallData = this.encodeFunctionCall('mintWithDeposits', [
            lynxAmount,
            wbtcAmount,
            usdcAmount,
            wethAmount,
            xsauceAmount
        ]);

        const contractExecution = new ContractExecuteTransaction()
            .setContractId(this.depositMinterAddress)
            .setGas(300000)
            .setPayableAmount(new Hbar(5.9)) // HBAR payment for mint
            .setFunctionParameters(functionCallData);

        const scheduledTx = new ScheduleCreateTransaction()
            .setScheduledTransaction(contractExecution)
            .setPayerAccountId(this.thresholdAccountId)
            .setScheduleMemo(`TEST: LYNX token mint operation [${Date.now()}]`);

        const frozenTx = await scheduledTx.freezeWith(this.client);
        
        const txResponse = await frozenTx.execute(this.client);
        const receipt = await txResponse.getReceipt(this.client);
        
        return receipt.scheduleId!.toString();
    }

    /**
     * SCENARIO 2: Governance ratio update
     */
    private async createValidRatioUpdate(): Promise<string> {
        // Update ratios within valid bounds (1-100)
        const hbarRatio = 60; // Slight increase from 59
        const wbtcRatio = 1;
        const usdcRatio = 29; // Slight decrease from 30
        const wethRatio = 1;
        const xsauceRatio = 9;

        const functionCallData = this.encodeFunctionCall('updateRatios', [
            hbarRatio,
            wbtcRatio,
            usdcRatio,
            wethRatio,
            xsauceRatio
        ]);

        const contractExecution = new ContractExecuteTransaction()
            .setContractId(this.depositMinterAddress)
            .setGas(200000)
            .setFunctionParameters(functionCallData);

        const scheduledTx = new ScheduleCreateTransaction()
            .setScheduledTransaction(contractExecution)
            .setPayerAccountId(this.thresholdAccountId)
            .setScheduleMemo(`TEST: Governance ratio update [${Date.now()}]`);

        const frozenTx = await scheduledTx.freezeWith(this.client);
        
        const txResponse = await frozenTx.execute(this.client);
        const receipt = await txResponse.getReceipt(this.client);
        
        return receipt.scheduleId!.toString();
    }

    /**
     * SCENARIO 3: Admin supply adjustment
     */
    private async createValidSupplyAdjustment(): Promise<string> {
        // Adjust supply tracking to 1,000,000 LYNX
        const newSupply = 1000000;

        const functionCallData = this.encodeFunctionCall('adjustSupply', [newSupply]);

        const contractExecution = new ContractExecuteTransaction()
            .setContractId(this.depositMinterAddress)
            .setGas(100000)
            .setFunctionParameters(functionCallData);

        const scheduledTx = new ScheduleCreateTransaction()
            .setScheduledTransaction(contractExecution)
            .setPayerAccountId(this.thresholdAccountId)
            .setScheduleMemo(`TEST: Admin supply adjustment [${Date.now()}]`);

        const frozenTx = await scheduledTx.freezeWith(this.client);
        
        const txResponse = await frozenTx.execute(this.client);
        const receipt = await txResponse.getReceipt(this.client);
        
        return receipt.scheduleId!.toString();
    }

    /**
     * SCENARIO 4: Ratio update with boundary test values
     */
    private async createInvalidRatioUpdate(): Promise<string> {
        // Try to set HBAR ratio to 0 (below MIN_RATIO of 1) - should be rejected
        const hbarRatio = 0; // INVALID: below minimum
        const wbtcRatio = 1;
        const usdcRatio = 30;
        const wethRatio = 1;
        const xsauceRatio = 9;

        const functionCallData = this.encodeFunctionCall('updateRatios', [
            hbarRatio,
            wbtcRatio,
            usdcRatio,
            wethRatio,
            xsauceRatio
        ]);

        const contractExecution = new ContractExecuteTransaction()
            .setContractId(this.depositMinterAddress)
            .setGas(200000)
            .setFunctionParameters(functionCallData);

        const scheduledTx = new ScheduleCreateTransaction()
            .setScheduledTransaction(contractExecution)
            .setPayerAccountId(this.thresholdAccountId)
            .setScheduleMemo(`TEST: Ratio configuration update [${Date.now()}]`)

        const frozenTx = await scheduledTx.freezeWith(this.client);
        
        const txResponse = await frozenTx.execute(this.client);
        const receipt = await txResponse.getReceipt(this.client);
        
        return receipt.scheduleId!.toString();
    }

    /**
     * SCENARIO 5: Ratio update with maximum values
     */
    private async createExcessiveRatioUpdate(): Promise<string> {
        // Try to set all ratios to 100 (max) - technically valid but suspicious
        const hbarRatio = 100;
        const wbtcRatio = 100;
        const usdcRatio = 100;
        const wethRatio = 100;
        const xsauceRatio = 100;

        const functionCallData = this.encodeFunctionCall('adminUpdateRatios', [
            hbarRatio,
            wbtcRatio,
            usdcRatio,
            wethRatio,
            xsauceRatio
        ]);

        const contractExecution = new ContractExecuteTransaction()
            .setContractId(this.depositMinterAddress)
            .setGas(200000)
            .setFunctionParameters(functionCallData);

        const scheduledTx = new ScheduleCreateTransaction()
            .setScheduledTransaction(contractExecution)
            .setPayerAccountId(this.thresholdAccountId)
            .setScheduleMemo(`TEST: Comprehensive ratio update [${Date.now()}]`)

        const frozenTx = await scheduledTx.freezeWith(this.client);
        
        const txResponse = await frozenTx.execute(this.client);
        const receipt = await txResponse.getReceipt(this.client);
        
        return receipt.scheduleId!.toString();
    }

    /**
     * SCENARIO 6: Ratio update with concentrated allocation
     */
    private async createImbalancedRatioUpdate(): Promise<string> {
        // Set HBAR ratio very high and others very low - technically valid but economically dangerous
        const hbarRatio = 99;
        const wbtcRatio = 1;
        const usdcRatio = 1;
        const wethRatio = 1;
        const xsauceRatio = 1;

        const functionCallData = this.encodeFunctionCall('updateRatios', [
            hbarRatio,
            wbtcRatio,
            usdcRatio,
            wethRatio,
            xsauceRatio
        ]);

        const contractExecution = new ContractExecuteTransaction()
            .setContractId(this.depositMinterAddress)
            .setGas(200000)
            .setFunctionParameters(functionCallData);

        const scheduledTx = new ScheduleCreateTransaction()
            .setScheduledTransaction(contractExecution)
            .setPayerAccountId(this.thresholdAccountId)
            .setScheduleMemo(`TEST: Asset ratio rebalancing [${Date.now()}]`)

        const frozenTx = await scheduledTx.freezeWith(this.client);
        
        const txResponse = await frozenTx.execute(this.client);
        const receipt = await txResponse.getReceipt(this.client);
        
        return receipt.scheduleId!.toString();
    }

    /**
     * SCENARIO 7: Mint with minimal deposit amounts
     */
    private async createInsufficientDepositMint(): Promise<string> {
        // Try to mint 1 LYNX but with way too little token deposits
        const lynxAmount = 1;
        const wbtcAmount = 1; // Way too low
        const usdcAmount = 1; // Way too low
        const wethAmount = 1; // Way too low
        const xsauceAmount = 1; // Way too low

        const functionCallData = this.encodeFunctionCall('mintWithDeposits', [
            lynxAmount,
            wbtcAmount,
            usdcAmount,
            wethAmount,
            xsauceAmount
        ]);

        const contractExecution = new ContractExecuteTransaction()
            .setContractId(this.depositMinterAddress)
            .setGas(300000)
            .setPayableAmount(new Hbar(0.01)) // Also insufficient HBAR
            .setFunctionParameters(functionCallData);

        const scheduledTx = new ScheduleCreateTransaction()
            .setScheduledTransaction(contractExecution)
            .setPayerAccountId(this.thresholdAccountId)
            .setScheduleMemo(`TEST: Mint with deposits [${Date.now()}]`)

        const frozenTx = await scheduledTx.freezeWith(this.client);
        
        const txResponse = await frozenTx.execute(this.client);
        const receipt = await txResponse.getReceipt(this.client);
        
        return receipt.scheduleId!.toString();
    }

    /**
     * SCENARIO 8: Governance address update
     */
    private async createUnauthorizedGovernanceChange(): Promise<string> {
        // Try to change governance to a different address
        const newGovernance = '0x0000000000000000000000000000000000000000'; // Zero address

        const functionCallData = this.encodeFunctionCall('setGovernanceAddress', [newGovernance]);

        const contractExecution = new ContractExecuteTransaction()
            .setContractId(this.depositMinterAddress)
            .setGas(100000)
            .setFunctionParameters(functionCallData);

        const scheduledTx = new ScheduleCreateTransaction()
            .setScheduledTransaction(contractExecution)
            .setPayerAccountId(this.thresholdAccountId)
            .setScheduleMemo(`TEST: Transfer governance control [${Date.now()}]`)

        const frozenTx = await scheduledTx.freezeWith(this.client);
        
        const txResponse = await frozenTx.execute(this.client);
        const receipt = await txResponse.getReceipt(this.client);
        
        return receipt.scheduleId!.toString();
    }

    /**
     * Run all test scenarios
     */
    public async createAllTestTransactions(): Promise<void> {
        console.log('🧪 Creating test transactions for Keyring Signer Agent...\n');
        console.log(`📋 Operator (Creating Txs): ${this.operatorId}`);
        console.log(`🔐 Threshold Account (Target): ${this.thresholdAccountId}`);
        console.log(`📝 Contract: ${this.depositMinterAddress}\n`);

        const scenarios: TestScenario[] = [
            {
                name: 'Valid Mint',
                description: 'User mints 1 LYNX with correct deposit amounts',
                expectedRisk: 'low',
                createTransaction: () => this.createValidMintTransaction(),
            },
            {
                name: 'Valid Ratio Update',
                description: 'Governance updates ratios within valid bounds',
                expectedRisk: 'medium',
                createTransaction: () => this.createValidRatioUpdate(),
            },
            {
                name: 'Valid Supply Adjustment',
                description: 'Admin adjusts supply tracking',
                expectedRisk: 'medium',
                createTransaction: () => this.createValidSupplyAdjustment(),
            },
            {
                name: 'Invalid Ratio (Out of Bounds)',
                description: 'Attempt to set ratio below minimum (0)',
                expectedRisk: 'high',
                createTransaction: () => this.createInvalidRatioUpdate(),
            },
            {
                name: 'Excessive Ratio Update',
                description: 'Set all ratios to maximum (100) - suspicious',
                expectedRisk: 'critical',
                createTransaction: () => this.createExcessiveRatioUpdate(),
            },
            {
                name: 'Imbalanced Ratios',
                description: 'Set HBAR ratio to 99%, others to 1% - dangerous',
                expectedRisk: 'critical',
                createTransaction: () => this.createImbalancedRatioUpdate(),
            },
            {
                name: 'Insufficient Deposits',
                description: 'Try to mint with way too little tokens',
                expectedRisk: 'high',
                createTransaction: () => this.createInsufficientDepositMint(),
            },
            {
                name: 'Unauthorized Governance Change',
                description: 'Attempt to change governance to zero address',
                expectedRisk: 'critical',
                createTransaction: () => this.createUnauthorizedGovernanceChange(),
            },
        ];

        const results: Array<{ scenario: string; scheduleId: string; expectedRisk: string; }> = [];

        for (const scenario of scenarios) {
            try {
                console.log(`📤 Creating: ${scenario.name}`);
                console.log(`   Description: ${scenario.description}`);
                
                const scheduleId = await scenario.createTransaction();
                results.push({
                    scenario: scenario.name,
                    scheduleId,
                    expectedRisk: scenario.expectedRisk,
                });
                
                console.log(`   ✅ Created: ${scheduleId}\n`);
                
                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error: any) {
                console.error(`   ❌ Failed: ${error.message}\n`);
            }
        }

        console.log('\n' + '='.repeat(80));
        console.log('📊 TEST TRANSACTION SUMMARY');
        console.log('='.repeat(80) + '\n');

        results.forEach(result => {
            console.log(`📋 ${result.scenario}`);
            console.log(`   Schedule ID: ${result.scheduleId}\n`);
        });

        console.log('='.repeat(80));
        console.log('✅ Test transaction creation complete!');
        console.log(`📝 Total created: ${results.length}/${scenarios.length}`);
        console.log('\n💡 Run your agent to review these transactions:');
        console.log('   npm start\n');
    }
}

// Main execution
async function main() {
    try {
        const creator = new TestTransactionCreator();
        await creator.createAllTestTransactions();
        process.exit(0);
    } catch (error: any) {
        console.error('❌ Error creating test transactions:', error);
        process.exit(1);
    }
}

main();

