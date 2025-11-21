import {
    Client,
    PrivateKey,
    PublicKey,
    KeyList,
    AccountCreateTransaction,
    AccountInfoQuery,
    Hbar
  } from "@hashgraph/sdk";
  import * as dotenv from "dotenv";
  import * as path from "path";
  
// Load .env from the project root
dotenv.config();

interface CreateThresholdOptions {
  publicKeys: string[];
  threshold?: number; // Optional, defaults to number of keys (all required)
}

async function createThresholdKeyList(options: CreateThresholdOptions): Promise<void> {
  const { publicKeys, threshold } = options;
  
  // Validate minimum of 2 public keys
  if (!publicKeys || publicKeys.length < 2) {
    throw new Error("At least 2 public keys are required to create a threshold key list");
  }
  
  // Default threshold to all keys if not specified
  const effectiveThreshold = threshold ?? publicKeys.length;
  
  // Validate threshold is valid
  if (effectiveThreshold < 1 || effectiveThreshold > publicKeys.length) {
    throw new Error(`Threshold must be between 1 and ${publicKeys.length} (number of keys)`);
  }
    // Get network from environment variable
    const NETWORK = process.env.HEDERA_NETWORK || 'testnet';
    const isMainnet = NETWORK === 'mainnet';
    
    // Configure client based on network
    const client = isMainnet ? Client.forMainnet() : Client.forTestnet();
    
    // Set operator account
    const operatorId = process.env.HEDERA_ACCOUNT_ID;
    const operatorKey = process.env.HEDERA_PRIVATE_KEY;
    
    if (!operatorId || !operatorKey) {
      console.log("Please set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY in your .env file");
      console.log("You can get credentials from: https://portal.hedera.com/register");
      return;
    }
    
    client.setOperator(operatorId, operatorKey);
    
    try {
      console.log(`🔑 Creating KeyList with ${publicKeys.length} public keys...\n`);
      
      // Convert string public keys to PublicKey objects
      const parsedPublicKeys: PublicKey[] = publicKeys.map((keyString, index) => {
        try {
          // First try as DER format
          if (keyString.startsWith('302a')) {
            return PublicKey.fromString(keyString);
          }
          // If it's a private key DER format, extract the public key
          else if (keyString.startsWith('302e020100')) {
            const privateKey = PrivateKey.fromString(keyString);
            return privateKey.publicKey;
          }
          // If it's raw hex (32 bytes), try as ED25519 raw bytes
          else if (keyString.length === 64) {
            return PublicKey.fromBytesED25519(Buffer.from(keyString, 'hex'));
          }
          // Default fallback
          else {
            return PublicKey.fromString(keyString);
          }
        } catch (error) {
          console.error(`Error parsing key ${index + 1}: ${keyString}`);
          console.error(`Error: ${error}`);
          throw new Error(`Failed to parse public key ${index + 1}`);
        }
      });
      
      // Create a threshold KeyList with the specified threshold
      const keyList = new KeyList(parsedPublicKeys, effectiveThreshold);
      
      console.log("KeyList created:");
      console.log(`Keys: ${keyList._keys.length}`);
      console.log(`Threshold: ${effectiveThreshold} of ${parsedPublicKeys.length} keys required`);
      console.log(`Structure: ${keyList.toString()}\n`);
      
      // Create an account with this KeyList as admin key
      console.log("Creating test account with KeyList as admin key...");
      
      const accountCreateTx = new AccountCreateTransaction()
        .setKey(keyList)
        .setInitialBalance(new Hbar(1))
        .setAccountMemo("KeyRing Protocol KeyList Test Account")
        .freezeWith(client);
      
      const accountCreateSign = await accountCreateTx.sign(PrivateKey.fromString(operatorKey));
      const accountCreateSubmit = await accountCreateSign.execute(client);
      const accountCreateRx = await accountCreateSubmit.getReceipt(client);
      const accountId = accountCreateRx.accountId;
      
      if (!accountId) {
        throw new Error("Failed to create account - no account ID returned");
      }
      
      console.log(`✅ Account created: ${accountId}\n`);
      
      // Query account info to see the KeyList structure on-chain
      console.log("Querying account info to see on-chain key structure...");
      const accountInfo = await new AccountInfoQuery()
        .setAccountId(accountId)
        .execute(client);
      
      console.log("📊 On-Chain Account Information:");
      console.log(`Account ID: ${accountInfo.accountId}`);
      console.log(`Balance: ${accountInfo.balance}`);
      console.log(`Account Memo: ${accountInfo.accountMemo}`);
      console.log(`Key Structure: ${accountInfo.key}`);
      console.log(`Key Type: ${accountInfo.key?.constructor.name}`);
      
      if (accountInfo.key instanceof KeyList) {
        console.log(`Number of Keys: ${accountInfo.key._keys.length}`);
        console.log("Individual Keys:");
        accountInfo.key._keys.forEach((key: any, index: number) => {
          console.log(`  Key ${index + 1}: ${key.toString()}`);
        });
      }
      
      console.log("\n🎉 KeyList created successfully on Hedera testnet!");
      
    } catch (error) {
      console.error("❌ Error creating KeyList:", error);
    } finally {
      client.close();
    }
  }
  
// Run the script with keys from environment
const operatorPublicKey = process.env.OPERATOR_PUBLIC_KEY;
const testSigner1 = process.env.TEST_SIGNER1;
const testSigner2 = process.env.TEST_SIGNER2;

if (!operatorPublicKey || !testSigner1 || !testSigner2) {
  console.error("❌ Missing required environment variables:");
  console.error("Please set OPERATOR_PUBLIC_KEY, TEST_SIGNER1, and TEST_SIGNER2 in your .env file");
  process.exit(1);
}

const thresholdPublicKeys = [
  operatorPublicKey,
  testSigner1,
  testSigner2
];

console.log("🔑 Creating threshold key list with 3 signers (2 of 3 required)...\n");

createThresholdKeyList({
  publicKeys: thresholdPublicKeys,
  threshold: 2 // 2 of 3 keys required
});

export { createThresholdKeyList, CreateThresholdOptions };
  