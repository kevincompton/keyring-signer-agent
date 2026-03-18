# Rejection Topic Signers (Mainnet)

`rejection-topic-signers-mainnet.csv` lists public keys allowed to submit to the rejection topic (threshold signers only).

**This file is gitignored** — copy from `rejection-topic-signers-mainnet.csv.example` and fill in the validator agent's public key.

**Columns:** `account_id`, `public_key`, `source`

- **agent** – Validator agent (HEDERA_ACCOUNT_ID=0.0.10378936). Replace `REPLACE_WITH_OPERATOR_PUBLIC_KEY` with your OPERATOR_PUBLIC_KEY value.
- **db_signer** – Signers from the DB (mainnet, `is_testnet=false`)
- **passive_agent** – Passive agents from `AGENT_CONFIGS`

**Note:** OPERATOR_PUBLIC_KEY from env is also added automatically, so the agent is included even if the CSV row has a placeholder.
