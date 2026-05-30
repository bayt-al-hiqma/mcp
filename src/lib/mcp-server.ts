/**
 * MCP JSON-RPC server implementation
 */

import { Config } from '../types/index.js';
import { MEMORY_TOOLS } from '../tools/definitions.js';
import { ToolHandlers } from '../tools/handlers.js';

interface JSONRPCRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: any;
}

interface JSONRPCResponse {
  jsonrpc: string;
  id?: string | number | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

interface JSONRPCError {
  code: number;
  message: string;
  data?: any;
}

const JSONRPC_ERRORS = {
  PARSE_ERROR: { code: -32700, message: 'Parse error' },
  INVALID_REQUEST: { code: -32600, message: 'Invalid Request' },
  METHOD_NOT_FOUND: { code: -32601, message: 'Method not found' },
  INVALID_PARAMS: { code: -32602, message: 'Invalid params' },
  INTERNAL_ERROR: { code: -32603, message: 'Internal error' }
};

export class MCPServer {
  private config: Config;
  private toolHandlers: ToolHandlers;

  constructor(config: Config) {
    this.config = config;
    this.toolHandlers = new ToolHandlers(config);
  }

  /**
   * Handle a JSON-RPC request
   */
  async handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    // Validate JSON-RPC version
    if (request.jsonrpc !== '2.0') {
      return this.errorResponse(request.id, JSONRPC_ERRORS.INVALID_REQUEST);
    }

    // Route to appropriate method handler
    try {
      switch (request.method) {
        case 'initialize':
          return this.handleInitialize(request);
        case 'tools/list':
          return this.handleToolsList(request);
        case 'tools/call':
          return this.handleToolsCall(request);
        case 'ping':
          return this.handlePing(request);
        default:
          return this.errorResponse(request.id, JSONRPC_ERRORS.METHOD_NOT_FOUND);
      }
    } catch (error: any) {
      console.error('Error handling request:', error);
      return this.errorResponse(request.id, {
        code: JSONRPC_ERRORS.INTERNAL_ERROR.code,
        message: JSONRPC_ERRORS.INTERNAL_ERROR.message,
        data: { error: error.message }
      });
    }
  }

  /**
   * Handle initialize method
   */
  private handleInitialize(request: JSONRPCRequest): JSONRPCResponse {
    return this.successResponse(request.id, {
      protocolVersion: '1.0',
      serverInfo: {
        name: 'Bayt al-Hiqma Personal Memory MCP',
        version: '0.1.0'
      },
      capabilities: {
        tools: {
          supported: true,
          listChanged: false
        }
      }
    });
  }

  /**
   * Handle tools/list method
   */
  private handleToolsList(request: JSONRPCRequest): JSONRPCResponse {
    return this.successResponse(request.id, {
      tools: MEMORY_TOOLS
    });
  }

  /**
   * Handle tools/call method
   */
  private async handleToolsCall(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    if (!request.params || !request.params.name) {
      return this.errorResponse(request.id, {
        code: JSONRPC_ERRORS.INVALID_PARAMS.code,
        message: 'Missing tool name',
        data: null
      });
    }

    const { name, arguments: args } = request.params;

    // Find tool
    const tool = MEMORY_TOOLS.find(t => t.name === name);
    if (!tool) {
      return this.errorResponse(request.id, {
        code: JSONRPC_ERRORS.METHOD_NOT_FOUND.code,
        message: `Tool not found: ${name}`,
        data: null
      });
    }

    // Validate required arguments
    if (tool.inputSchema.required) {
      for (const required of tool.inputSchema.required) {
        if (!(required in (args || {}))) {
          return this.errorResponse(request.id, {
            code: JSONRPC_ERRORS.INVALID_PARAMS.code,
            message: `Missing required parameter: ${required}`,
            data: null
          });
        }
      }
    }

    try {
      const result = await this.toolHandlers.callTool(name, args || {});

      return this.successResponse(request.id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      });
    } catch (error: any) {
      console.error(`Error calling tool ${name}:`, error);
      return this.errorResponse(request.id, {
        code: JSONRPC_ERRORS.INTERNAL_ERROR.code,
        message: `Tool execution failed: ${error.message}`,
        data: null
      });
    }
  }

  /**
   * Handle ping method
   */
  private handlePing(request: JSONRPCRequest): JSONRPCResponse {
    return this.successResponse(request.id, {});
  }

  /**
   * Create a success response
   */
  private successResponse(id: string | number | null | undefined, result: any): JSONRPCResponse {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      result
    };
  }

  /**
   * Create an error response
   */
  private errorResponse(
    id: string | number | null | undefined,
    error: JSONRPCError
  ): JSONRPCResponse {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      error
    };
  }

  /**
   * Parse and handle a request from raw text
   */
  async handleRawRequest(body: string): Promise<JSONRPCResponse> {
    try {
      const request = JSON.parse(body) as JSONRPCRequest;
      return await this.handleRequest(request);
    } catch (error) {
      return this.errorResponse(null, JSONRPC_ERRORS.PARSE_ERROR);
    }
  }

  /**
   * Verify authentication
   */
  verifyAuth(authHeader: string | undefined): boolean {
    if (!authHeader) {
      return false;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return false;
    }

    return parts[1] === this.config.mcpAuthSecret;
  }
}
