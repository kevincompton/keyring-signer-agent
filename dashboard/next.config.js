const { config } = require('dotenv');
const { join } = require('path');

// Load environment variables from parent directory (workspace root)
config({ path: join(__dirname, '..', '.env') });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
    // Server-side env vars are automatically available, but we can expose specific ones if needed
  },
}

module.exports = nextConfig

