#!/usr/bin/env node

// Suppress noisy warnings and errors
import './suppress-warnings.js';

import { config } from 'dotenv';
import { KeyringSignerAgent } from './agent/keyring-signer-agent.js';

// Load environment variables
config();

/**
 * KeyRing Signer Agent - Main Entry Point
 * 
 * This is the main entry point for the KeyRing Signer Agent.
 * The agent monitors HCS topics for scheduled transactions and
 * autonomously signs approved transactions for multi-sig accounts.
 */
async function main(): Promise<void> {
  console.log("🦌⚡ Keyring Signer Agent");
  console.log("========================");

  try {
    // Create and initialize the signer agent
    const agent = new KeyringSignerAgent();
    
    // Initialize the agent
    await agent.initialize();
    
    // Start the agent (this will block and listen for messages)
    await agent.start();

  } catch (error) {
    console.error("❌ Failed to start Keyring Signer Agent:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
} 