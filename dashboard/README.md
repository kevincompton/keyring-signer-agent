# KeyRing Signer Agent Dashboard

Next.js dashboard for monitoring and controlling KeyRing autonomous signer agents.

## Features

- Real-time transaction monitoring
- Project information display from HCS topics
- Threshold account visualization
- Signature tracking
- Test transaction triggers
- Auto-refresh every 30 seconds

## Architecture

This dashboard uses **Next.js API Routes** - no separate API server needed! The API routes query Hedera mirror nodes and HCS topics directly.

## Getting Started

### Install Dependencies

```bash
npm install
```

### Configure Environment

Create `.env.local` with your Hedera configuration:

```bash
# Hedera Configuration
HEDERA_NETWORK=testnet
HEDERA_ACCOUNT_ID=0.0.xxxxx
HEDERA_PRIVATE_KEY=302e020100300506032b657004220420...
OPERATOR_PUBLIC_KEY=302a300506032b6570032100...

# Project Configuration
PROJECT_REGISTRY_TOPIC=0.0.xxxxx
THRESHOLD_ACCOUNT_ID=0.0.xxxxx
LYNX_TESTNET_OPERATOR_ID=0.0.xxxxx
```

**Quick setup:** Copy from root `.env`:
```bash
cp ../.env .env.local
```

### Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

**That's it! No separate API server needed.**

### Build for Production

```bash
npm run build
npm start
```

## Project Structure

```
dashboard/
├── app/
│   ├── api/                   # Next.js API Routes
│   │   ├── project/          # Fetches from HCS topic
│   │   ├── threshold/        # Queries Hedera account
│   │   ├── transactions/     # Queries mirror node
│   │   ├── stats/            # Calculates statistics
│   │   └── test-transactions/ # Triggers test creation
│   ├── layout.tsx            # Root layout
│   ├── page.tsx              # Main dashboard page
│   └── globals.css           # Global styles
├── components/               # React components
│   ├── ProjectCard.tsx
│   ├── ThresholdCard.tsx
│   ├── TransactionsList.tsx
│   └── StatsCards.tsx
├── lib/
│   └── api.ts               # API client functions
├── types/
│   └── index.ts             # TypeScript types
└── public/                  # Static assets
```

## API Routes

The dashboard includes these Next.js API routes:

- `GET /api/project` - Fetch project from HCS topic
- `GET /api/threshold` - Query threshold account details
- `GET /api/transactions` - Fetch scheduled transactions from mirror node
- `GET /api/stats` - Calculate dashboard statistics
- `POST /api/test-transactions` - Trigger test transaction creation

## Data Sources

All data is fetched directly from Hedera:

1. **Project Info** → HCS-2 Topic via Mirror Node REST API
2. **Threshold Account** → Direct Hedera SDK query
3. **Scheduled Transactions** → Mirror Node Schedules API
4. **Stats** → Calculated from mirror node data

No agent interaction required for dashboard operation.

## Components

### ProjectCard
Displays verified project information including company details, owners, and operator account.

### ThresholdCard
Shows threshold account configuration, balance, and list of authorized signers.

### TransactionsList
Lists all scheduled transactions with status indicators and signature information.

### StatsCards
Overview cards showing transaction counts and states.

## Styling

Built with Tailwind CSS and supports dark mode based on system preferences.

## Deployment

### Vercel (Recommended)

1. Connect your GitHub repository to Vercel
2. Set root directory to `dashboard`
3. Add environment variables from `.env.local`
4. Deploy

Vercel automatically handles the Next.js API routes!

### Environment Variables for Production

Set these in your Vercel project settings:

```
HEDERA_NETWORK
HEDERA_ACCOUNT_ID
HEDERA_PRIVATE_KEY
OPERATOR_PUBLIC_KEY
PROJECT_REGISTRY_TOPIC
THRESHOLD_ACCOUNT_ID
LYNX_TESTNET_OPERATOR_ID
```

## Local Development

Single command:

```bash
npm run dev
```

That's it! The dashboard includes its own API routes.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Next.js API Routes](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)
- [Hedera SDK](https://docs.hedera.com/hedera/sdks-and-apis/sdks)
- [Tailwind CSS](https://tailwindcss.com/docs)
