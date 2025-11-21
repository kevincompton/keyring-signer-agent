# 🧪 Test Transaction Scenarios

This document describes the test transactions created by the `createTestTransactions.ts` utility script to validate the Keyring Signer Agent's ability to analyze and respond to various transaction types.

## Overview

The test transaction generator creates 8 different scheduled transactions against the Lynx `DepositMinterV2` contract, covering a range of scenarios from valid operations to suspicious/malicious activities.

## Running the Test Generator

```bash
# Install dependencies (first time only)
npm install

# Create test transactions
npm run test:transactions
```

**Important:** The script uses two accounts:
- **Operator Account** (`HEDERA_ACCOUNT_ID`): Creates and submits the scheduled transactions
- **Threshold Account** (`THRESHOLD_ACCOUNT_ID`): The multi-sig account that will execute the transactions (requires agent's signature)

## Test Scenarios

### ✅ Valid Transactions (Expected: SIGN)

These transactions should be analyzed as **LOW or MEDIUM risk** and **signed** by the agent.

#### 1. 🟢 Valid LYNX Mint (LOW RISK)
- **Function**: `mintWithDeposits`
- **Description**: User mints 1 LYNX token with correct deposit amounts
- **Deposits**:
  - HBAR: 5.9
  - WBTC: 0.001 (100,000 smallest units)
  - USDC: 0.3 (300,000 smallest units)
  - WETH: 0.001 (100,000 smallest units)
  - XSAUCE: 0.9 (900,000 smallest units)
- **Why Valid**: All deposit amounts match the required ratios based on the contract's `calculateRequiredDeposits` function
- **Expected Agent Action**: Sign transaction after validating deposit ratios

#### 2. 🟡 Valid Governance Ratio Update (MEDIUM RISK)
- **Function**: `updateRatios`
- **Description**: Governance updates minting ratios within valid bounds
- **New Ratios**:
  - HBAR: 60 (slight increase from 59)
  - WBTC: 1 (unchanged)
  - USDC: 29 (slight decrease from 30)
  - WETH: 1 (unchanged)
  - XSAUCE: 9 (unchanged)
- **Why Valid**: All ratios are within the 1-100 bounds and represent reasonable economic adjustments
- **Expected Agent Action**: Sign after validating caller is governance address and ratios are within bounds

#### 3. 🟡 Valid Admin Supply Adjustment (MEDIUM RISK)
- **Function**: `adjustSupply`
- **Description**: Admin adjusts the tracked LYNX total supply
- **New Supply**: 1,000,000 LYNX
- **Why Valid**: Admin function for fixing supply tracking discrepancies without redeployment
- **Expected Agent Action**: Sign after validating caller is admin address

---

### ❌ Invalid/Suspicious Transactions (Expected: REJECT)

These transactions should be analyzed as **HIGH or CRITICAL risk** and **rejected** by the agent with detailed reasoning posted to the rejection topic.

#### 4. 🟠 Invalid Ratio - Out of Bounds (HIGH RISK)
- **Function**: `updateRatios`
- **Description**: Attempt to set HBAR ratio to 0 (below minimum of 1)
- **Invalid Ratio**: HBAR = 0 (violates MIN_RATIO)
- **Why Invalid**: Contract enforces MIN_RATIO = 1, this would revert on-chain
- **Expected Agent Action**: 
  - Reject transaction
  - Post to `PROJECT_REJECTION_TOPIC` with feedback: "Ratio below minimum bound (0 < 1)"

#### 5. 🔴 Excessive Ratio Update (CRITICAL RISK)
- **Function**: `adminUpdateRatios`
- **Description**: Set all ratios to maximum value (100)
- **Ratios**: All set to 100
- **Why Suspicious**: While technically valid, setting all ratios to max simultaneously is economically irrational and likely malicious
- **Expected Agent Action**:
  - Reject transaction
  - Post to `PROJECT_REJECTION_TOPIC` with feedback: "All ratios set to maximum - highly suspicious pattern"

#### 6. 🔴 Imbalanced Ratios (CRITICAL RISK)
- **Function**: `updateRatios`
- **Description**: Set HBAR ratio to 99%, reducing all others to 1%
- **Ratios**:
  - HBAR: 99
  - WBTC: 1
  - USDC: 1
  - WETH: 1
  - XSAUCE: 1
- **Why Dangerous**: Dramatically shifts the economic balance to favor HBAR, making minting extremely expensive and potentially breaking the peg
- **Expected Agent Action**:
  - Reject transaction
  - Post to `PROJECT_REJECTION_TOPIC` with feedback: "Extreme ratio imbalance detected - HBAR 99% vs others 1%"

#### 7. 🟠 Insufficient Deposits (HIGH RISK)
- **Function**: `mintWithDeposits`
- **Description**: Attempt to mint 1 LYNX with way too little tokens
- **Deposits**:
  - HBAR: 0.01 (should be ~5.9)
  - WBTC: 1 smallest unit (should be ~100,000)
  - USDC: 1 smallest unit (should be ~300,000)
  - WETH: 1 smallest unit (should be ~100,000)
  - XSAUCE: 1 smallest unit (should be ~900,000)
- **Why Invalid**: Contract will revert with `InsufficientDeposit` error
- **Expected Agent Action**:
  - Reject transaction
  - Post to `PROJECT_REJECTION_TOPIC` with feedback: "Deposit amounts far below requirements"

#### 8. 🔴 Unauthorized Governance Change (CRITICAL RISK)
- **Function**: `setGovernanceAddress`
- **Description**: Attempt to change governance to zero address
- **New Governance**: `0x0000000000000000000000000000000000000000`
- **Why Critical**: 
  - Setting governance to zero address permanently removes governance control
  - This is an admin-only function and should be heavily scrutinized
  - Zero address is a common pattern for malicious takeovers
- **Expected Agent Action**:
  - Reject transaction
  - Post to `PROJECT_REJECTION_TOPIC` with feedback: "Governance change to zero address - permanent loss of control"

---

## Agent Validation Workflow

For each test transaction, the agent should:

1. **Fetch Transaction Details**
   - Use `fetch_pending_transactions` tool
   - Decode transaction body to identify function and parameters

2. **Analyze Against Contract ABI**
   - Load `DepositMinterV2.json` ABI
   - Parse function call and parameters
   - Validate against expected contract behavior

3. **Risk Assessment**
   - Calculate risk level: low, medium, high, critical
   - Consider:
     - Parameter bounds (MIN_RATIO/MAX_RATIO)
     - Economic reasonableness
     - Access control (admin/governance)
     - Common attack patterns

4. **Post Validation Message**
   - ALWAYS post to `PROJECT_VALIDATOR_TOPIC`
   - Include: scheduleId, reviewer, description, riskLevel, timestamp, projectRegistrationTxId

5. **Decision**
   - **If LOW/MEDIUM risk**: Sign using `sign_transaction` tool
   - **If HIGH/CRITICAL risk**: Reject and post detailed feedback to `PROJECT_REJECTION_TOPIC`

---

## Contract Reference

### DepositMinterV2 Key Constants

```solidity
// Ratio bounds
uint256 public constant MIN_RATIO = 1;
uint256 public constant MAX_RATIO = 100;

// Current ratios (can be updated by governance)
uint256 public HBAR_RATIO = 59;
uint256 public WBTC_RATIO = 1;
uint256 public USDC_RATIO = 30;
uint256 public WETH_RATIO = 1;
uint256 public XSAUCE_RATIO = 9;

// Token decimals
uint8 public constant USDC_DECIMALS = 6;
uint8 public constant WETH_DECIMALS = 8;
uint8 public constant XSAUCE_DECIMALS = 6;
uint8 public constant WBTC_DECIMALS = 8;
uint8 public constant LYNX_DECIMALS = 8;
```

### Access Control

- **ADMIN**: Can call `adjustSupply`, `adminUpdateRatios`, `setGovernanceAddress`
- **GOVERNANCE**: Can call `updateRatios`
- **Anyone**: Can call `mintWithDeposits`, `transferLynxForBurn`, `withdrawUnderlyingTokens`, `burnLynxTokens`

---

## Expected Results Summary

| Scenario | Function | Expected Risk | Expected Action |
|----------|----------|---------------|-----------------|
| 1. Valid Mint | `mintWithDeposits` | LOW | ✅ Sign |
| 2. Valid Ratio Update | `updateRatios` | MEDIUM | ✅ Sign |
| 3. Valid Supply Adjustment | `adjustSupply` | MEDIUM | ✅ Sign |
| 4. Invalid Ratio (< min) | `updateRatios` | HIGH | ❌ Reject |
| 5. Excessive Ratios (all max) | `adminUpdateRatios` | CRITICAL | ❌ Reject |
| 6. Imbalanced Ratios (99% HBAR) | `updateRatios` | CRITICAL | ❌ Reject |
| 7. Insufficient Deposits | `mintWithDeposits` | HIGH | ❌ Reject |
| 8. Governance to Zero Address | `setGovernanceAddress` | CRITICAL | ❌ Reject |

---

## Troubleshooting

### "Missing THRESHOLD_ACCOUNT_ID" Error
- Add `THRESHOLD_ACCOUNT_ID` to your `.env` file
- This must be the multi-sig account with the agent's key in its threshold key list
- Create one using `npm run threshold:create` if needed

### "Contract not found" Error
- Verify `DEPOSIT_MINTER_CONTRACT` in your `.env` file
- Default is `0.0.4337514` (Lynx mainnet)
- For testnet, deploy your own contract or use a test instance

### "Insufficient Balance" Error
- Ensure your **operator account** has sufficient HBAR for transaction fees
- Each scheduled transaction creation costs ~$0.01-0.05

### Agent Not Detecting Transactions
1. Verify `PROJECT_REGISTRY_TOPIC` contains the **threshold account** registration (not operator)
2. Confirm agent's public key is in the **threshold account's** key list
3. Check that scheduled transactions are in "PENDING" state (not expired)
4. Ensure transactions show the threshold account as the payer

---

## Next Steps

After creating test transactions:

1. **Run the agent**: `npm start`
2. **Monitor agent output**: Watch console for transaction reviews
3. **Check HCS topics**: 
   - View validation messages in `PROJECT_VALIDATOR_TOPIC`
   - View rejections in `PROJECT_REJECTION_TOPIC`
4. **Verify signatures**: Check if expected transactions were signed on Hedera

---

## Contributing

To add new test scenarios:

1. Add a new method to `TestTransactionCreator` class
2. Encode the function call using the contract ABI
3. Add the scenario to the `scenarios` array in `createAllTestTransactions`
4. Document the scenario in this file

Example:

```typescript
private async createNewTestScenario(): Promise<string> {
    const functionCallData = this.encodeFunctionCall('functionName', [param1, param2]);
    
    const contractExecution = new ContractExecuteTransaction()
        .setContractId(this.depositMinterAddress)
        .setGas(200000)
        .setFunctionParameters(functionCallData);

    const scheduledTx = new ScheduleCreateTransaction()
        .setScheduledTransaction(contractExecution)
        .setScheduleMemo('TEST: New scenario - RISK LEVEL')
        .setAdminKey(this.operatorKey);

    const txResponse = await scheduledTx.execute(this.client);
    const receipt = await txResponse.getReceipt(this.client);
    
    return receipt.scheduleId!.toString();
}
```

---

**Happy Testing! 🧪✨**

