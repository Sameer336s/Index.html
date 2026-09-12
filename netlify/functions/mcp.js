/**
 * Neon Slide — MCP-style endpoint (Model Context Protocol over HTTP/JSON).
 *
 * Endpoint: /api/mcp  (redirected from /.netlify/functions/mcp)
 *
 * GET  → server info + instructions
 * POST → JSON-RPC 2.0 style:
 *   { "jsonrpc": "2.0", "id": 1, "method": "initialize" }
 *   { "jsonrpc": "2.0", "id": 2, "method": "tools/list" }
 *   { "jsonrpc": "2.0", "id": 3, "method": "tools/call",
 *     "params": { "name": "get_leaderboard", "arguments": { "size": 4 } } }
 *
 * Tool results are returned as MCP content blocks:
 *   { "content": [{ "type": "text", "text": "..." }], "isError": false }
 *
 * This lets any MCP-capable client (Claude, editors, agents) use NeonBot's
 * game tools directly, in addition to the in-page chat that uses them
 * automatically via the Sarvam AI tool-calling loop.
 */
const { getUserFromEvent, json } = require('./_utils');
const { mcpTools, executeTool } = require('./_mcp-tools');

const SERVER_INFO = {
  name: 'neonslide-mcp',
  version: '1.0.0',
  protocolVersion: '2025-06-18',
  description: 'MCP-style tools for Neon Slide: game info, live leaderboard, player best scores, board analysis, optimal move hints and Sarvam AI translation.',
  instructions: 'Call tools/list to discover tools, then tools/call with a name and arguments.',
};

function rpcResponse(id, result) {
  return json(200, { jsonrpc: '2.0', id, result });
}

function rpcError(id, code, message) {
  return json(200, { jsonrpc: '2.0', id, error: { code, message } });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'GET') {
    return json(200, SERVER_INFO);
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed. Use GET or POST.' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return rpcError(null, -32700, 'Parse error: invalid JSON.'); }

  const id = body.id !== undefined ? body.id : null;
  const method = typeof body.method === 'string' ? body.method : '';
  const params = body.params && typeof body.params === 'object' ? body.params : {};

  const ctx = {
    user: getUserFromEvent(event),
    game_context: null,
    apiKey: process.env.SARVAM_API_KEY,
  };

  try {
    if (method === 'initialize') {
      return rpcResponse(id, {
        protocolVersion: SERVER_INFO.protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_INFO.name, version: SERVER_INFO.version },
        instructions: SERVER_INFO.instructions,
      });
    }

    if (method === 'tools/list') {
      return rpcResponse(id, { tools: mcpTools() });
    }

    if (method === 'tools/call') {
      const name = typeof params.name === 'string' ? params.name : '';
      if (!name) return rpcError(id, -32602, "Invalid params: 'name' is required.");
      const known = mcpTools().find((t) => t.name === name);
      if (!known) return rpcError(id, -32602, `Unknown tool: ${name}`);

      let result;
      try {
        result = await executeTool(name, params.arguments || {}, ctx);
      } catch (e) {
        return rpcResponse(id, {
          content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }],
          isError: true,
        });
      }
      const isError = result && result.error === true;
      return rpcResponse(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: !!isError,
      });
    }

    if (method === 'resources/list') {
      return rpcResponse(id, { resources: [] });
    }

    if (method === 'prompts/list') {
      return rpcResponse(id, { prompts: [] });
    }

    return rpcError(id, -32601, `Method not found: ${method}`);
  } catch (e) {
    return rpcError(id, -32603, `Internal error: ${e.message}`);
  }
};
