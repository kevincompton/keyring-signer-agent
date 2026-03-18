/**
 * Load environment from project root .env ONLY.
 * NEVER use dashboard/.env.local or any other env file in scripts or agent.
 */
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });
