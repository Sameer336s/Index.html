/**
 * NeonBot — AI chat companion for Neon Slide.
 * Backend: Netlify Function. Powered by Sarvam AI with MCP-style tool calling.
 *
 * The Sarvam AI API key is read from process.env.SARVAM_API_KEY and NEVER
 * reaches the browser. If it is missing the function answers gracefully.
 *
 * Endpoint: POST /api/chat  (redirected from /.netlify/functions/chat)
 * Body: { messages: [{role:'user'|'assistant', content}], game_context, session_id }
 * Returns: { reply, tools_used:[{name,label}] }
 */
const { getUserFromEvent, json } = require('./_utils');
const { openAiTools, executeTool, toolLabel, GAME_INFO } = require('./_mcp-tools');

const SARVAM_CHAT_URL = 'https://api.sarvam.ai/v1/chat/completions';
const DEFAULT_MODEL = process.env.SARVAM_MODEL || 'sarvam-m';
const MAX_TOOL_ROUNDS = 3;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 4000;
const FETCH_TIMEOUT_MS = 8000;
const OVERALL_DEADLINE_MS = 9000;

// ── in-memory rate limit (per function instance) ──
const rateBuckets = new Map();
function rateLimited(key) {
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || now - b.windowStart > 10 * 60 * 1000) {
    b = { windowStart: now, count: 0 };
    rateBuckets.set(key, b);
  }
  b.count++;
  return b.count > 30;
}

const SYSTEM_PROMPT = [
  'You are NeonBot, the in-game AI companion for Neon Slide, a cyberpunk tile sliding puzzle game.',
  'You are friendly, concise and multilingual — reply in the same language/script the player uses.',
  "You can answer questions, explain rules, give strategy, and (because you have MCP-style tools) inspect the live game, fetch the leaderboard, look up a player's best score, analyze the current board, suggest the next optimal move, and translate text.",
  'Use your tools whenever they help — e.g. if a player asks "what should I do now" or "give me a hint", call get_next_move_hint; if they ask "who is on top", call get_leaderboard; if they want to talk in their own language, you may translate a phrase with translate_text.',
  'When a tool returns data, turn it into a short, warm, useful answer rather than dumping raw JSON.',
  'You do not move tiles for the player — you only advise.',
].join(' ');

function buildSystemMessages(user, gameContextRaw) {
  const sys = { role: 'system', content: SYSTEM_PROMPT };

  const info = {
    name: GAME_INFO.name,
    boardSizes: GAME_INFO.boardSizes,
    rules: GAME_INFO.rules,
    scoring: 'Fewer moves = more stars. Leaderboard ranks by fewest moves; ties broken by fastest time.',
  };
  const ctxMsg = {
    role: 'system',
    content: 'Game reference:\n' + JSON.stringify(info),
  };

  let ctxLine = '';
  if (user && user.username) {
    ctxLine += `The player is logged in as "${user.username}".\n`;
  } else {
    ctxLine += 'The player is browsing as a guest (not logged in).\n';
  }

  const gameContext = gameContextRaw && typeof gameContextRaw === 'object' ? gameContextRaw : null;
  if (gameContext) {
    const safe = {
      size: Number.isInteger(gameContext.size) ? gameContext.size : undefined,
      moves: Number.isInteger(gameContext.moves) ? gameContext.moves : undefined,
      won: gameContext.won === true,
      elapsedSeconds: Number.isFinite(gameContext.elapsedSeconds) ? gameContext.elapsedSeconds : undefined,
      solvedTiles: Number.isInteger(gameContext.solvedTiles) ? gameContext.solvedTiles : undefined,
      totalTiles: Number.isInteger(gameContext.totalTiles) ? gameContext.totalTiles : undefined,
      board: Array.isArray(gameContext.board) ? gameContext.board : undefined,
      player: typeof gameContext.player === 'string' ? gameContext.player.slice(0, 24) : undefined,
    };
    const compact = JSON.stringify(safe);
    if (compact && compact.length < 2000) {
      ctxLine += 'Current live game context: ' + compact;
    } else {
      ctxLine += 'No live board is available right now.';
    }
  } else {
    ctxLine += 'No live game context is available right now.';
  }

  return [sys, ctxMsg, { role: 'system', content: ctxLine.trim() }];
}

function sanitizeMessages(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const m of input) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = typeof m.content === 'string' ? m.content.slice(0, MAX_MESSAGE_CHARS) : '';
    if (!content) continue;
    out.push({ role, content });
    if (out.length >= MAX_MESSAGES) break;
  }
  // ensure conversation starts with a user turn
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

async function callSarvam(messages, apiKey, deadline) {
  const remaining = deadline - Date.now();
  const timeout = Math.min(FETCH_TIMEOUT_MS, Math.max(2000, remaining));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(SARVAM_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': apiKey,
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages,
        temperature: 0.6,
        max_tokens: 800,
        tools: openAiTools(),
        tool_choice: 'auto',
      }),
      signal: controller.signal,
    });
    if (resp.status === 401 || resp.status === 403) {
      const err = new Error('SARVAM_AUTH');
      err.code = 'SARVAM_AUTH';
      throw err;
    }
    if (resp.status === 429) {
      const err = new Error('SARVAM_RATE');
      err.code = 'SARVAM_RATE';
      throw err;
    }
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`Sarvam ${resp.status}: ${detail.slice(0, 200)}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': 'same-origin' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed. Use POST.' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid JSON body.' }); }

  const ip = (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  const sessionKey = (body.session_id && typeof body.session_id === 'string') ? body.session_id.slice(0, 64) : ip;
  if (rateLimited(sessionKey + '|' + ip)) {
    return json(429, { error: 'You are chatting too fast. Please wait a moment and try again.' });
  }

  const messages = sanitizeMessages(body.messages);
  if (!messages.length) {
    return json(400, { error: 'No message provided.' });
  }

  const apiKey = process.env.SARVAM_API_KEY;
  const user = getUserFromEvent(event);
  const ctx = { user, game_context: body.game_context, apiKey };

  if (!apiKey) {
    return json(200, {
      reply: "NeonBot is connected but its AI key isn't configured yet. The site owner needs to set the SARVAM_API_KEY environment variable in Netlify.",
      tools_used: [],
      configured: false,
    });
  }

  const convo = buildSystemMessages(user, body.game_context).concat(messages);
  const toolsUsed = [];
  const deadline = Date.now() + OVERALL_DEADLINE_MS;

  try {
    let lastReply = '';
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (Date.now() >= deadline) break;
      const data = await callSarvam(convo, apiKey, deadline);
      const choice = data && data.choices && data.choices[0];
      if (!choice || !choice.message) {
        break;
      }
      const msg = choice.message;

      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
        // append the assistant turn that requested tools
        convo.push({ role: 'assistant', tool_calls: msg.tool_calls });
        for (const call of msg.tool_calls) {
          const toolName = call && call.function && call.function.name;
          const toolCallId = call && call.id ? call.id : `call_${toolName}_${round}`;
          if (!toolName) {
            convo.push({ role: 'tool', tool_call_id: toolCallId, content: JSON.stringify({ error: 'Malformed tool call.' }) });
            continue;
          }
          let parsedArgs = {};
          try { parsedArgs = call.function.arguments ? JSON.parse(call.function.arguments) : {}; }
          catch { parsedArgs = {}; }
          let result;
          try {
            result = await executeTool(toolName, parsedArgs, ctx);
            if (!toolsUsed.find((t) => t.name === toolName)) {
              toolsUsed.push({ name: toolName, label: toolLabel(toolName) });
            }
          } catch (e) {
            result = { error: `Tool "${toolName}" failed: ${e.message}` };
          }
          convo.push({ role: 'tool', tool_call_id: toolCallId, content: JSON.stringify(result) });
        }
        continue;
      }

      // final answer
      lastReply = typeof msg.content === 'string' ? msg.content.trim() : '';
      if (lastReply) {
        return json(200, { reply: lastReply, tools_used: toolsUsed });
      }
      break;
    }

    return json(200, {
      reply: lastReply || "I started on that but ran out of time — please try again in a moment.",
      tools_used: toolsUsed,
      truncated: true,
    });
  } catch (e) {
    if (e.code === 'SARVAM_AUTH') {
      return json(200, { reply: 'NeonBot cannot connect right now because the Sarvam AI API key is not valid. Please ask the site owner to check the SARVAM_API_KEY environment variable.', tools_used: [] });
    }
    if (e.code === 'SARVAM_RATE') {
      return json(200, { reply: 'NeonBot is a bit busy right now (rate limit). Please try again in a few seconds.', tools_used: [] });
    }
    const aborted = e && (e.name === 'AbortError' || /aborted/i.test(e.message || ''));
    if (aborted) {
      return json(200, { reply: 'NeonBot took too long to think that one through — please try again.', tools_used: toolsUsed });
    }
    return json(200, { reply: 'NeonBot hit a snag reaching the AI service. Please try again shortly.', tools_used: toolsUsed });
  }
};
