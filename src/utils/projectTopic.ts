// Load environment variables FIRST, before any other imports that depend on them
import { config } from 'dotenv';
config(); // Loads .env by default

// Now import everything else
import { Client, TopicMessageSubmitTransaction, TopicCreateTransaction, TopicInfoQuery, PrivateKey, AccountId, TopicId } from '@hashgraph/sdk';

// Get network from environment variable
const NETWORK = process.env.HEDERA_NETWORK || 'testnet';
const isMainnet = NETWORK === 'mainnet';

async function getOrCreateProjectRegistryTopic(client: Client, network: string, operatorKey: PrivateKey): Promise<string> {
    // Check for existing topic ID in environment
    const existingTopicId = process.env.PROJECT_REGISTRY_TOPIC;

    if (existingTopicId && existingTopicId !== '0.0.0') {
        try {
          // Try to query the existing topic to see if it's valid
          await new TopicInfoQuery()
            .setTopicId(existingTopicId)
            .execute(client);
          
          console.log(`✓ Using existing ${network} project registry topic:`, existingTopicId);
          return existingTopicId;
        } catch (error) {
          console.log(`⚠️  Existing ${network} topic not found or invalid, creating new topic...`);
        }
      }

    // Create a new topic for KeyRing verified projects registry
    console.log(`📝 Creating new KeyRing Project Registry topic on ${network.toUpperCase()} (HCS-2 indexed)...`);
    const createTopicTx = new TopicCreateTransaction()
        .setTopicMemo('hcs-2:0:86400') // HCS-2 indexed topic, 24 hour TTL
        .setSubmitKey(operatorKey.publicKey);

    const createResponse = await createTopicTx.execute(client);
    const createReceipt = await createResponse.getReceipt(client);
    const newTopicId = createReceipt.topicId!.toString();

    console.log(`✅ Created new ${network} project registry topic with ID:`, newTopicId);
    console.log(`\n📋 Add this to your .env.local file:\nPROJECT_REGISTRY_TOPIC=${newTopicId}\n`);
    return newTopicId;
}

async function sendTestProject() {
    try {
        console.log('\n🌐 KeyRing Project Registration');
        console.log('═══════════════════════════════════════\n');
        
        // Validate network configuration
        if (!NETWORK || (NETWORK !== 'testnet' && NETWORK !== 'mainnet')) {
            throw new Error('HEDERA_NETWORK must be set to "testnet" or "mainnet"');
        }
        
        console.log(`📡 Network: ${NETWORK.toUpperCase()}`);
        
        // Get credentials from environment
        const accountIdValue = process.env.HEDERA_ACCOUNT_ID;
        const privateKeyValue = process.env.HEDERA_PRIVATE_KEY;
        
        if (!accountIdValue) {
            throw new Error('Missing HEDERA_ACCOUNT_ID environment variable');
        }
        if (!privateKeyValue) {
            throw new Error('Missing HEDERA_PRIVATE_KEY environment variable');
        }
        
        const operatorId = AccountId.fromString(accountIdValue);
        let operatorPrivateKey: PrivateKey;

        try {
            operatorPrivateKey = PrivateKey.fromStringDer(privateKeyValue);
        } catch (error) {
            console.error("❌ Error parsing private key:", error);
            throw error;
        }
        
        console.log(`🔑 Operator Account: ${operatorId}\n`);
        
        // Configure client based on network
        const client = isMainnet 
            ? Client.forMainnet().setOperator(operatorId, operatorPrivateKey)
            : Client.forTestnet().setOperator(operatorId, operatorPrivateKey);
        
        const topicId = await getOrCreateProjectRegistryTopic(client, NETWORK, operatorPrivateKey);

        // Get Lynx testnet operator ID (the account that creates transactions)
        const lynxOperatorId = process.env.LYNX_TESTNET_OPERATOR_ID;
        if (!lynxOperatorId) {
            throw new Error('Missing LYNX_TESTNET_OPERATOR_ID environment variable');
        }

        // Project data matching new database schema
        const projectData = {
            companyName: "Lynxify",
            legalEntityName: "Lynxify LLC",
            publicRecordUrl: "https://wyobiz.wyo.gov/Business/FilingDetails.aspx?eFNum=006087115039222233134008027248138231208044036098",
            owners: ["Jason Cox", "Kevin Compton"],
            metadata: {
                description: "Lynxify is a Wyoming-based company that provides a suite of tools for the Hedera ecosystem.",
                operatorAccountId: lynxOperatorId,
                status: "verified"
            }
        };

        // Create HCS-2 message with new schema fields
        const hcs2Message = {
            "p": "hcs-2",
            "op": "register",
            "t_id": lynxOperatorId, // Lynx operator account ID (creates transactions)
            "metadata": {
                company_name: projectData.companyName,
                legal_entity_name: projectData.legalEntityName,
                public_record_url: projectData.publicRecordUrl,
                owners: projectData.owners,
                ...projectData.metadata
            },
            "m": "KeyRing verified project registration"
        };

        // Submit to HCS-2 topic
        const projectMessage = JSON.stringify(hcs2Message);
        const transaction = new TopicMessageSubmitTransaction()
            .setTopicId(topicId)
            .setMessage(projectMessage);

        const response = await transaction.execute(client);
        const receipt = await response.getReceipt(client);
        const transactionId = response.transactionId.toString();

        console.log('\n🎉 Project registered successfully on Hedera HCS-2 topic!');
        console.log('═══════════════════════════════════════');
        console.log(`Network: ${NETWORK.toUpperCase()}`);
        console.log('Registry Topic ID:', topicId);
        console.log('Transaction ID:', transactionId);
        console.log('Status:', receipt.status.toString());
        
        // Add network-specific explorer links
        const explorerBase = isMainnet 
            ? 'https://hashscan.io/mainnet' 
            : 'https://hashscan.io/testnet';
        console.log(`\n🔍 View on HashScan:`);
        console.log(`Topic: ${explorerBase}/topic/${topicId}`);
        console.log(`Transaction: ${explorerBase}/transaction/${transactionId}`);

        console.log('\n📋 HCS-2 Message Sent:');
        console.log(JSON.stringify(hcs2Message, null, 2));
        
        console.log('\n✨ Registration Complete!\n');
        
        // Close the client
        client.close();
        
    } catch (error) {
        console.error("\n❌ Error registering project:", error);
        console.error('\n💡 Troubleshooting:');
        console.error('- Ensure HEDERA_NETWORK is set to "testnet" or "mainnet"');
        console.error('- Set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY in your .env file');
        console.error('- Check that your account has sufficient HBAR balance');
        console.error(`- Current network: ${NETWORK}\n`);
        throw error;
    }
}

// Run the script
sendTestProject();