#!/usr/bin/env node

// Suppress noisy warnings and errors
import './suppress-warnings.js';

import { config } from 'dotenv';
import { KeyringSignerAgent } from './agent/keyring-signer-agent.js';

// Load environment variables
config();

/**
 * Lynx Balancer Agent - Main Entry Point
 * 
 * This is the main entry point for the Lynx Balancer Agent.
 * The agent listens for governance updates via HCS-10 and executes
 * portfolio rebalancing operations on Hedera.
 */
async function main(): Promise<void> {
  console.log("🦌⚡ Keyring Signer Agent");
  console.log("========================");

  try {
    // Create and initialize the balancer agent
    const agent = new KeyringSignerAgent();
    
    // Initialize the agent
    await agent.initialize();
    
    // Start the agent (this will block and listen for messages)
    await agent.start();

  } catch (error) {
    console.error("❌ Failed to start Lynx Balancer Agent:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
} 