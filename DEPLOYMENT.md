# KeyRing Signer Agent - Deployment Guide

This guide covers deploying the KeyRing Signer Agent backend to Render and the Next.js dashboard to Vercel.

## Architecture

The project uses a monorepo structure with separate deployments:

```
keyring-signer-agent/
├── src/                    # Backend agent code
├── dashboard/              # Next.js frontend
├── render.yaml            # Render configuration
└── vercel.json            # Vercel configuration
```

**Backend (Render):** Runs the autonomous agent and API server
**Frontend (Vercel):** Hosts the dashboard UI

## Prerequisites

- GitHub repository containing this code
- Hedera testnet/mainnet account credentials
- OpenAI API key (for agent)
- Render account (free tier works)
- Vercel account (free tier works)

## Environment Variables

### Backend Environment Variables

Create these in Render or your `.env` file:

```bash
# Hedera Network Configuration
HEDERA_NETWORK=testnet
HEDERA_ACCOUNT_ID=0.0.xxxxx
HEDERA_PRIVATE_KEY=302e020100300506032b657004220420...
OPERATOR_PUBLIC_KEY=302a300506032b6570032100...

# Project Configuration
PROJECT_REGISTRY_TOPIC=0.0.xxxxx
THRESHOLD_ACCOUNT_ID=0.0.xxxxx
LYNX_TESTNET_OPERATOR_ID=0.0.xxxxx

# API Configuration
API_PORT=3001

# AI Configuration
OPENAI_API_KEY=sk-...

# Test Signers (optional, for testing)
TEST_SIGNER1=302a300506032b6570032100...
TEST_SIGNER2=302a300506032b6570032100...
```

### Frontend Environment Variables

Create these in Vercel or `dashboard/.env.local`:

```bash
NEXT_PUBLIC_API_URL=https://your-render-app.onrender.com
```

## Deploying to Render

### Option 1: Using render.yaml (Recommended)

1. **Connect Repository**
   - Go to [render.com](https://render.com)
   - Click "New +" → "Blueprint"
   - Connect your GitHub repository
   - Render will automatically detect `render.yaml`

2. **Configure Environment Variables**
   - In the Render dashboard, go to each service
   - Add all required environment variables listed above
   - Click "Save Changes"

3. **Deploy**
   - Render will automatically deploy both services:
     - `keyring-signer-agent-api` (Web Service - API server)
     - `keyring-signer-agent` (Background Worker - Agent)

### Option 2: Manual Setup

1. **Create API Service**
   - New + → Web Service
   - Connect repository
   - Name: `keyring-signer-agent-api`
   - Build Command: `npm install`
   - Start Command: `npm run api`
   - Add environment variables

2. **Create Agent Worker**
   - New + → Background Worker
   - Connect repository
   - Name: `keyring-signer-agent`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Add environment variables

## Deploying to Vercel

### Option 1: Using vercel.json (Recommended)

1. **Install Vercel CLI** (optional)
   ```bash
   npm i -g vercel
   ```

2. **Deploy from Dashboard**
   - Go to [vercel.com](https://vercel.com)
   - Click "Add New..." → "Project"
   - Import your GitHub repository
   - Vercel will detect `vercel.json` configuration
   - Root Directory: Leave as default (vercel.json handles it)
   - Click "Deploy"

3. **Configure Environment Variables**
   - In Vercel dashboard → Settings → Environment Variables
   - Add: `NEXT_PUBLIC_API_URL` = `https://your-render-app.onrender.com`
   - Redeploy

### Option 2: Manual Dashboard Configuration

1. **Import Project**
   - Import GitHub repository to Vercel
   - Framework Preset: Next.js
   - Root Directory: `dashboard`
   - Build Command: `npm run build`
   - Output Directory: `.next`

2. **Add Environment Variables**
   - Settings → Environment Variables
   - Add `NEXT_PUBLIC_API_URL`

3. **Deploy**

## Verifying Deployment

### Test Backend API

```bash
# Check health
curl https://your-render-app.onrender.com/health

# Test project endpoint
curl https://your-render-app.onrender.com/api/project

# Test threshold endpoint
curl https://your-render-app.onrender.com/api/threshold

# Test transactions endpoint
curl https://your-render-app.onrender.com/api/transactions
```

### Test Dashboard

1. Visit your Vercel URL: `https://your-app.vercel.app`
2. Dashboard should load and display:
   - Project information
   - Threshold account details
   - Scheduled transactions list
   - Stats cards

3. Test functionality:
   - Click "Refresh" to reload data
   - Click "Test Transactions" to trigger test transactions

## CORS Configuration

The backend API is configured with CORS enabled for all origins. In production, you may want to restrict this:

In `src/api/server.ts`:

```typescript
app.use(cors({
  origin: 'https://your-app.vercel.app'
}));
```

## Monitoring

### Render
- View logs in Render dashboard
- Monitor both API and Agent services
- Set up alerts for service failures

### Vercel
- View deployment logs
- Monitor function executions
- Check analytics for usage

## Troubleshooting

### Dashboard shows "Failed to load data"
- Verify API server is running on Render
- Check `NEXT_PUBLIC_API_URL` is set correctly
- Verify CORS is enabled in backend

### Agent not signing transactions
- Check Render logs for the agent worker
- Verify `OPERATOR_PUBLIC_KEY` matches threshold account
- Ensure `PROJECT_REGISTRY_TOPIC` is correct

### API returns 400/500 errors
- Check all environment variables are set
- Verify Hedera credentials are valid
- Check Render logs for specific errors

## Local Development

### Run Backend API
```bash
npm install
npm run api
```

### Run Dashboard
```bash
cd dashboard
npm install
npm run dev
```

### Run Agent
```bash
npm start
```

## CI/CD

Both Render and Vercel support automatic deployments:

- **Render:** Deploys on push to main branch
- **Vercel:** Deploys on push to main (production) and preview deployments for PRs

Configure in platform settings to change deployment behavior.

## Cost Considerations

### Render Free Tier
- Web services spin down after 15 min inactivity
- 750 hours/month free (sufficient for one service)
- Consider paid plan for always-on agent

### Vercel Free Tier
- 100 GB bandwidth/month
- Unlimited deployments
- Sufficient for demo/prototype

## Security Notes

- Never commit `.env` files
- Use environment variables for all secrets
- Rotate keys regularly
- Monitor API usage for anomalies
- Consider IP allowlisting for production

## Support

For issues or questions:
- Check logs in Render/Vercel dashboards
- Review environment variable configuration
- Ensure Hedera testnet is operational
- Verify API connectivity between services

