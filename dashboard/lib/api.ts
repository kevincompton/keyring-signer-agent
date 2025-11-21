/**
 * API client functions for KeyRing Dashboard
 * Uses Next.js API routes (relative paths)
 */

export async function fetchProjectInfo() {
  const response = await fetch('/api/project');
  if (!response.ok) {
    throw new Error('Failed to fetch project info');
  }
  return response.json();
}

export async function fetchThresholdInfo() {
  const response = await fetch('/api/threshold');
  if (!response.ok) {
    throw new Error('Failed to fetch threshold info');
  }
  return response.json();
}

export async function fetchTransactions() {
  const response = await fetch('/api/transactions');
  if (!response.ok) {
    throw new Error('Failed to fetch transactions');
  }
  return response.json();
}

export async function fetchStats() {
  const response = await fetch('/api/stats');
  if (!response.ok) {
    throw new Error('Failed to fetch stats');
  }
  return response.json();
}

export async function triggerTestTransactions() {
  const response = await fetch('/api/test-transactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error('Failed to trigger test transactions');
  }
  return response.json();
}

export async function fetchRejections() {
  const response = await fetch('/api/rejections');
  if (!response.ok) {
    throw new Error('Failed to fetch rejections');
  }
  return response.json();
}

