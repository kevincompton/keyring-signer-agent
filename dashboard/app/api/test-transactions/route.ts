import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { join } from 'path';
import { config } from 'dotenv';

export async function POST() {
  try {
    // Load environment variables from workspace root
    const workspaceRoot = join(process.cwd(), '..');
    config({ path: join(workspaceRoot, '.env') });
    
    const scriptPath = join(workspaceRoot, 'src', 'utils', 'createTestTransactions.ts');
    
    console.log('[TEST_TX_TRIGGER] Starting test transaction creation...');
    console.log('[TEST_TX_TRIGGER] Workspace root:', workspaceRoot);
    console.log('[TEST_TX_TRIGGER] Script path:', scriptPath);
    
    // Spawn the test transaction script as a child process
    // Pass environment variables explicitly
    const child = spawn('node', ['--loader', 'ts-node/esm', scriptPath], {
      cwd: workspaceRoot,
      env: {
        ...process.env, // Pass all current environment variables
        NODE_ENV: process.env.NODE_ENV || 'development'
      },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'] // Capture stdout and stderr
    });
    
    // Log output for debugging
    child.stdout?.on('data', (data) => {
      console.log('[TEST_TX]', data.toString());
    });
    
    child.stderr?.on('data', (data) => {
      console.error('[TEST_TX_ERROR]', data.toString());
    });
    
    child.on('error', (error) => {
      console.error('[TEST_TX_SPAWN_ERROR]', error);
    });
    
    child.on('exit', (code) => {
      console.log(`[TEST_TX] Process exited with code ${code}`);
    });
    
    child.unref(); // Allow parent to exit independently

    return NextResponse.json({
      success: true,
      message: 'Test transactions creation initiated in background. Check server logs for progress.'
    });

  } catch (error) {
    console.error('[TEST_TX_TRIGGER_ERROR] Error triggering test transactions:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

