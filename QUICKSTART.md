# 🚀 KeyRing Signer Agent - Quick Start

Get up and running in 5 minutes!

## Prerequisites

- ✅ Node.js 18+
- ✅ Hedera testnet account (https://portal.hedera.com/register)
- ✅ OpenAI API key (https://platform.openai.com/api-keys)

## Installation

```bash
# Install backend
npm install

# Install dashboard
cd dashboard && npm install && cd ..
```

## Configuration

Create `.env`:

```bash
HEDERA_NETWORK=testnet
HEDERA_ACCOUNT_ID=0.0.YOUR_ID
HEDERA_PRIVATE_KEY=your_private_key_der
OPERATOR_PUBLIC_KEY=your_public_key_der
OPENAI_API_KEY=sk-your_key

# Generate with: npm run project:register
PROJECT_REGISTRY_TOPIC=

# Generate with: npm run threshold:create  
THRESHOLD_ACCOUNT_ID=

# Optional test signers
TEST_SIGNER1=
TEST_SIGNER2=
```

Create `dashboard/.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Setup Steps

### 1. Register Project

```bash
npm run project:register
```

Copy the topic ID to `.env` as `PROJECT_REGISTRY_TOPIC`

### 2. Create Threshold Account

```bash
npm run threshold:create
```

Copy the account ID to `.env` as `THRESHOLD_ACCOUNT_ID`

### 3. Start Services

**Terminal 1 - API:**
```bash
npm run api
```

**Terminal 2 - Dashboard:**
```bash
npm run dashboard
```

**Terminal 3 - Agent (optional):**
```bash
npm start
```

### 4. Open Dashboard

Visit: http://localhost:3000

### 5. Test

Click "Test Transactions" button in dashboard

## Verify It Works

✅ Dashboard loads and shows project info
✅ Threshold account displays with keys
✅ Test transactions appear in list
✅ Agent signs transactions (if running)
✅ Stats update in real-time

## Deploy to Production

### Backend → Render

```bash
# Push to GitHub
git push origin main

# In Render dashboard:
# - New Blueprint → Connect repo
# - Add environment variables
# - Deploy
```

### Frontend → Vercel

```bash
# In Vercel dashboard:
# - Import project from GitHub
# - Add NEXT_PUBLIC_API_URL=https://your-render-app.onrender.com
# - Deploy
```

## Common Commands

```bash
# Backend
npm start              # Run agent
npm run api            # Run API server

# Dashboard  
npm run dashboard      # Run dashboard dev server

# Utilities
npm run project:register     # Register project
npm run threshold:create     # Create threshold account
npm run test:transactions    # Create test transactions
```

## Troubleshooting

**Dashboard won't load?**
- Check API is running: `curl http://localhost:3001/health`
- Verify `.env` variables are set
- Check `dashboard/.env.local` has correct API URL

**No transactions appearing?**
- Run: `npm run test:transactions`
- Wait 30 seconds or click Refresh

**Agent not signing?**
- Verify `OPERATOR_PUBLIC_KEY` matches threshold key
- Check agent has HBAR balance
- Review agent console logs

## Next Steps

- 📖 Read [SETUP.md](./SETUP.md) for detailed instructions
- 🚀 See [DEPLOYMENT.md](./DEPLOYMENT.md) for production deployment
- 📚 Check [README.md](./README.md) for full documentation
- 🧪 Review [TEST_SCENARIOS.md](./TEST_SCENARIOS.md) for testing

## Support

Having issues? Check:
1. All environment variables are set
2. Hedera testnet is operational
3. Account has HBAR balance
4. Console logs for error messages

---

**Made with ❤️ for the KeyRing Protocol**

