# KeyRing Signer Agent - Setup Guide

Complete setup instructions for running the KeyRing Signer Agent locally and deploying to production.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [Hedera Configuration](#hedera-configuration)
4. [Project Registration](#project-registration)
5. [Threshold Account Creation](#threshold-account-creation)
6. [Running Locally](#running-locally)
7. [Testing](#testing)
8. [Deployment](#deployment)

## Prerequisites

### Required Accounts & Keys

- **Hedera Account:** Testnet or mainnet account with HBAR balance
  - Get testnet account: https://portal.hedera.com/register
  - Fund with testnet HBAR from faucet

- **OpenAI API Key:** For agent AI functionality
  - Get key: https://platform.openai.com/api-keys

- **Additional Test Signers:** 2+ additional ED25519 key pairs for threshold testing

### Required Software

- Node.js 18+ 
- npm or yarn
- Git

## Initial Setup

### 1. Clone Repository

```bash
git clone <your-repo-url>
cd keyring-signer-agent
```

### 2. Install Dependencies

```bash
# Backend
npm install

# Dashboard
cd dashboard
npm install
cd ..
```

### 3. Create Environment Files

Create `.env` in root:

```bash
cp env.example .env
```

Edit `.env` with your values:

```bash
# Hedera Network Configuration
HEDERA_NETWORK=testnet
HEDERA_ACCOUNT_ID=0.0.YOUR_ACCOUNT_ID
HEDERA_PRIVATE_KEY=302e020100300506032b657004220420...
OPERATOR_PUBLIC_KEY=302a300506032b6570032100...

# OpenAI Configuration
OPENAI_API_KEY=sk-...

# These will be filled in later:
PROJECT_REGISTRY_TOPIC=
THRESHOLD_ACCOUNT_ID=
LYNX_TESTNET_OPERATOR_ID=

# Test Signers (generate these)
TEST_SIGNER1=
TEST_SIGNER2=

# API Configuration
API_PORT=3001
```

Create `dashboard/.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Hedera Configuration

### Generate ED25519 Keys

You need your operator key plus 2 additional test signer keys for the threshold account.

**Option 1: Using Hedera SDK (Node.js)**

```javascript
const { PrivateKey } = require('@hashgraph/sdk');

// Generate new key
const privateKey = PrivateKey.generateED25519();
console.log('Private Key (DER):', privateKey.toStringDer());
console.log('Public Key (DER):', privateKey.publicKey.toStringDer());
```

**Option 2: Using Portal**

Use the Hedera Portal to generate keys and copy the DER-encoded values.

**Add to .env:**

```bash
OPERATOR_PUBLIC_KEY=302a300506032b6570032100... # Your operator's public key
TEST_SIGNER1=302a300506032b6570032100...        # First test signer public key
TEST_SIGNER2=302a300506032b6570032100...        # Second test signer public key
```

## Project Registration

### 1. Register Project on HCS Topic

This creates a project registry HCS-2 topic and registers your project:

```bash
npm run project:register
```

**Output:**
```
✅ Created new testnet project registry topic with ID: 0.0.xxxxx

📋 Add this to your .env file:
PROJECT_REGISTRY_TOPIC=0.0.xxxxx
```

**Update .env:**

```bash
PROJECT_REGISTRY_TOPIC=0.0.xxxxx
```

### 2. Submit Contract Information

```bash
npm run project:contracts
```

### 3. Submit Audit Information

```bash
npm run project:audits
```

## Threshold Account Creation

Create a multi-signature threshold account with your agent as one of the signers:

```bash
npm run threshold:create
```

**Output:**
```
✅ Account created: 0.0.xxxxx

📊 On-Chain Account Information:
Account ID: 0.0.xxxxx
Threshold: 2 of 3 keys required
```

**Update .env:**

```bash
THRESHOLD_ACCOUNT_ID=0.0.xxxxx
```

## Running Locally

### Terminal 1: API Server

```bash
npm run api
```

Expected output:
```
🚀 KeyRing Dashboard API server running on port 3001
📡 Network: testnet
```

### Terminal 2: Dashboard

```bash
npm run dashboard
```

Expected output:
```
  ▲ Next.js 14.x.x
  - Local:        http://localhost:3000
```

Open browser: http://localhost:3000

### Terminal 3: Agent (Optional)

```bash
npm start
```

Expected output:
```
🦌⚡ Keyring Signer Agent
========================
✓ Agent initialized
✓ Tools loaded: 4 tools
✓ Listening to topics...
```

## Testing

### 1. Verify Dashboard Connection

Open http://localhost:3000 and verify:
- ✅ Project information displays
- ✅ Threshold account shows with 3 keys
- ✅ Stats cards show zeros (no transactions yet)

### 2. Create Test Transactions

Click "Test Transactions" button in dashboard OR run:

```bash
npm run test:transactions
```

This creates several scheduled transactions that require your threshold account's signatures.

### 3. Verify Transactions Appear

After ~30 seconds (or click Refresh):
- ✅ Transactions list populates
- ✅ Shows "Signature Required" badges
- ✅ Stats update with transaction counts

### 4. Test Agent Signing

If agent is running (Terminal 3), it should automatically:
- Detect pending transactions
- Evaluate them
- Sign approved transactions

Watch agent logs for activity:
```
[FETCH_PENDING_TX] Found 3 pending schedules
[SIGN_TX] Signing schedule: 0.0.xxxxx
✅ Successfully signed schedule
```

### 5. Verify Signatures

Refresh dashboard:
- ✅ Transaction status changes to "signed"
- ✅ Signature count increments
- ✅ Stats update

## Troubleshooting

### Dashboard shows "Failed to load data"

**Check:**
1. API server is running (Terminal 1)
2. `.env` has all required variables
3. `dashboard/.env.local` has correct API URL

**Test API directly:**
```bash
curl http://localhost:3001/health
curl http://localhost:3001/api/project
```

### "PROJECT_REGISTRY_TOPIC not configured"

Run:
```bash
npm run project:register
```

Add output topic ID to `.env`

### "THRESHOLD_ACCOUNT_ID not configured"

Run:
```bash
npm run threshold:create
```

Add output account ID to `.env`

### Agent not signing transactions

**Check:**
1. `OPERATOR_PUBLIC_KEY` matches one of the threshold keys
2. Agent has HBAR balance for transaction fees
3. Project is registered and verified
4. Scheduled transactions involve the threshold account

**View agent logs:**
The agent prints detailed logs about:
- What transactions it finds
- Whether they match criteria
- Signing attempts and results

### Test transactions fail to create

**Check:**
1. Contract deployment addresses in `createTestTransactions.ts`
2. Account has sufficient HBAR balance
3. Contract exists and is deployed
4. ABI files are present in `src/projects/abi/`

## Next Steps

After successful local testing:

1. **Review Logs:** Understand how agent evaluates transactions
2. **Test Scenarios:** Try different transaction types
3. **Deploy:** Follow [DEPLOYMENT.md](./DEPLOYMENT.md) for production deployment
4. **Monitor:** Use dashboard to monitor agent activity
5. **Iterate:** Adjust agent logic and rules as needed

## Environment Variable Reference

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `HEDERA_NETWORK` | Network to use | `testnet` or `mainnet` |
| `HEDERA_ACCOUNT_ID` | Your operator account | `0.0.12345` |
| `HEDERA_PRIVATE_KEY` | Operator private key (DER) | `302e0201...` |
| `OPERATOR_PUBLIC_KEY` | Operator public key (DER) | `302a3005...` |
| `OPENAI_API_KEY` | OpenAI API key | `sk-...` |
| `PROJECT_REGISTRY_TOPIC` | HCS topic ID | `0.0.12345` |
| `THRESHOLD_ACCOUNT_ID` | Multi-sig account ID | `0.0.12345` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `API_PORT` | API server port | `3001` |
| `LYNX_TESTNET_OPERATOR_ID` | Project operator account | Same as HEDERA_ACCOUNT_ID |
| `TEST_SIGNER1` | Test signer 1 public key | - |
| `TEST_SIGNER2` | Test signer 2 public key | - |

## Support

- **Issues:** Check logs for error messages
- **Configuration:** Verify all environment variables are set
- **Network:** Ensure Hedera testnet is operational
- **Documentation:** See [README.md](./README.md) and [DEPLOYMENT.md](./DEPLOYMENT.md)

## Security Notes

- Never commit `.env` files
- Keep private keys secure
- Use testnet for development
- Rotate keys regularly in production
- Monitor account balances and activity

---

**Ready to deploy?** See [DEPLOYMENT.md](./DEPLOYMENT.md) for production deployment instructions.

