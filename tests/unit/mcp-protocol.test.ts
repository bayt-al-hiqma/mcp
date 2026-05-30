/**
 * Tests for MCP protocol
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MCPServer } from '../src/lib/mcp-server.js';
import { Config } from '../src/types/index.js';

describe('MCP Protocol', () => {
  let config: Config;
  let server: MCPServer;

  beforeEach(() => {
    config = {
      vaultOwner: 'test-owner',
      vaultRepo: 'test-repo',
      vaultBranch: 'main',
      vaultRoot: '',
      dailyNotesDir: 'daily',
      githubToken: 'test-token',
      mcpAuthSecret: 'test-secret',
      maxFileSize: 1048576,
      maxSearchResults: 50,
      maxGraphNodes: 100
    };
    server = new MCPServer(config);
  });

  describe('handleRequest', () => {
    it('should reject non-2.0 JSON-RPC requests', async () => {
      const response = await server.handleRequest({
        jsonrpc: '1.0',
        method: 'test',
        id: 1
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32600);
    });

    it('should handle initialize request', async () => {
      const response = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1
      });

      expect(response.result).toBeDefined();
      expect(response.result.protocolVersion).toBe('1.0');
      expect(response.result.serverInfo.name).toContain('Bayt al-Hiqma');
    });

    it('should handle tools/list request', async () => {
      const response = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 2
      });

      expect(response.result).toBeDefined();
      expect(response.result.tools).toBeInstanceOf(Array);
      expect(response.result.tools.length).toBeGreaterThan(0);
    });

    it('should handle ping request', async () => {
      const response = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'ping',
        id: 3
      });

      expect(response.result).toBeDefined();
      expect(response.error).toBeUndefined();
    });

    it('should return error for unknown method', async () => {
      const response = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'unknown_method',
        id: 4
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32601);
    });

    it('should preserve request id in response', async () => {
      const response = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'ping',
        id: 'test-id-123'
      });

      expect(response.id).toBe('test-id-123');
    });
  });

  describe('handleRawRequest', () => {
    it('should parse valid JSON request', async () => {
      const rawRequest = JSON.stringify({
        jsonrpc: '2.0',
        method: 'ping',
        id: 1
      });

      const response = await server.handleRawRequest(rawRequest);

      expect(response.result).toBeDefined();
      expect(response.error).toBeUndefined();
    });

    it('should return parse error for invalid JSON', async () => {
      const response = await server.handleRawRequest('invalid json {');

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32700);
    });
  });

  describe('verifyAuth', () => {
    it('should accept valid bearer token', () => {
      const valid = server.verifyAuth('Bearer test-secret');
      expect(valid).toBe(true);
    });

    it('should reject invalid token', () => {
      const invalid = server.verifyAuth('Bearer wrong-secret');
      expect(invalid).toBe(false);
    });

    it('should reject malformed auth header', () => {
      expect(server.verifyAuth('test-secret')).toBe(false);
      expect(server.verifyAuth('Basic test-secret')).toBe(false);
      expect(server.verifyAuth('')).toBe(false);
      expect(server.verifyAuth(undefined)).toBe(false);
    });
  });

  describe('tools/call', () => {
    it('should return error for missing tool name', async () => {
      const response = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {},
        id: 1
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32602);
    });

    it('should return error for unknown tool', async () => {
      const response = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'nonexistent_tool',
          arguments: {}
        },
        id: 1
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32601);
    });

    it('should validate required parameters', async () => {
      const response = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'search_memories',
          arguments: {} // missing required 'query' parameter
        },
        id: 1
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32602);
      expect(response.error?.message).toContain('query');
    });
  });
});
