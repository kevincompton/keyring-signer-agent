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
    PROJECT_VALIDATOR_TOPIC?: string;
    PROJECT_VALIDATOR_INBOUND_TOPIC?: string;
    LYNX_REGISTRATION_TX?: string;
    /** KeyRing operator account (project dashboard) - transactions from this account are trusted for allowed actions (e.g. setAdmin to new threshold list) */
    KEYRING_OPERATOR_ACCOUNT_ID?: string;
    /** KeyRing operator public key (hex or DER) - required for creating operator inbound topic */
    KEYRING_OPERATOR_PUBLIC_KEY?: string;
    /** Operator inbound topic - restricted to KeyRing operator, HCS-2 non-indexed */
    PROJECT_OPERATOR_INBOUND_TOPIC?: string;
    /** Comma-separated inbound topic IDs for passive agents - after signing KeyRing operator tx, post schedule ID to each */
    PASSIVE_AGENT_INBOUND_TOPICS?: string;
}