/**
 * Configuration loader and validator
 */

import { Config } from '../types/index.js';

export function loadConfig(): Config {
  const required = [
    'VAULT_OWNER',
    'VAULT_REPO',
    'GITHUB_TOKEN',
    'MCP_AUTH_SECRET'
  ];

  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    vaultOwner: process.env.VAULT_OWNER!,
    vaultRepo: process.env.VAULT_REPO!,
    vaultBranch: process.env.VAULT_BRANCH || 'main',
    vaultRoot: process.env.VAULT_ROOT || '',
    dailyNotesDir: process.env.DAILY_NOTES_DIR || 'daily',
    githubToken: process.env.GITHUB_TOKEN!,
    mcpAuthSecret: process.env.MCP_AUTH_SECRET!,
    aiProvider: process.env.AI_PROVIDER,
    aiApiKey: process.env.AI_API_KEY,
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '1048576', 10), // 1MB default
    maxSearchResults: parseInt(process.env.MAX_SEARCH_RESULTS || '50', 10),
    maxGraphNodes: parseInt(process.env.MAX_GRAPH_NODES || '100', 10)
  };
}

export function validateConfig(config: Config): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.vaultOwner) errors.push('Vault owner is required');
  if (!config.vaultRepo) errors.push('Vault repository is required');
  if (!config.githubToken) errors.push('GitHub token is required');
  if (!config.mcpAuthSecret) errors.push('MCP auth secret is required');

  if (config.maxFileSize < 0) errors.push('Max file size must be positive');
  if (config.maxSearchResults < 1) errors.push('Max search results must be at least 1');
  if (config.maxGraphNodes < 1) errors.push('Max graph nodes must be at least 1');

  return {
    valid: errors.length === 0,
    errors
  };
}
