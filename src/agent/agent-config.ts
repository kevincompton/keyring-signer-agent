export interface EnvironmentConfig {
    HEDERA_NETWORK?: string;
    HEDERA_ACCOUNT_ID?: string;
    HEDERA_PRIVATE_KEY?: string;
    OPERATOR_PUBLIC_KEY?: string;
    OPENAI_API_KEY?: string;
    AI_GATEWAY_API_KEY?: string;
    PROJECT_OPERATOR_ACCOUNT_ID?: string;
    PROJECT_REGISTRY_TOPIC?: string;
    PROJECT_CONTRACTS_TOPIC?: string;
    PROJECT_AUDIT_TOPIC?: string;
    PROJECT_REJECTION_TOPIC?: string;
    PROJECT_VALIDATOR_REVIEW_TOPIC?: string;
    PROJECT_VALIDATOR_INBOUND_TOPIC?: string;
    LYNX_REGISTRATION_TX?: string;
    /** Lynx operator account (testnet) - creates scheduled transactions */
    LYNX_TESTNET_OPERATOR_ID?: string;
    /** Lynx operator account (mainnet) - used when HEDERA_NETWORK=mainnet */
    LYNX_OPERATOR_ACCOUNT_ID?: string;
    /** KeyRing operator account (project dashboard) - transactions from this account are trusted for allowed actions (e.g. setAdmin to new threshold list) */
    KEYRING_OPERATOR_ACCOUNT_ID?: string;
    /** KeyRing operator public key (hex or DER) - required for creating operator inbound topic */
    KEYRING_OPERATOR_PUBLIC_KEY?: string;
    /** KeyRing operator inbound topic - only KeyRing operator can bypass agent validation */
    KEYRING_OPERATOR_INBOUND_TOPIC_ID?: string;
    /** Comma-separated inbound topic IDs for passive agents - after signing KeyRing operator tx, post schedule ID to each */
    PASSIVE_AGENT_INBOUND_TOPICS?: string;
    /** Schedule review contract ID (0.0.xxxxx or 0x...) for schedule_passive_agents tool */
    SCHEDULE_REVIEW_CONTRACT_ID?: string;
    /** EVM private key (32-byte hex) for schedule review contract calls. Falls back to HEDERA_PRIVATE_KEY if secp256k1 */
    SCHEDULE_REVIEW_EVM_PRIVATE_KEY?: string;
}