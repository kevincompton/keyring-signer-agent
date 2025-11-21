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
    LYNX_REGISTRATION_TX?: string;
}