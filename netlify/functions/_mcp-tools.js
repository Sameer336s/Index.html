/**
 * NeonBot — MCP-style tool registry + executor.
 * Shared between the /api/chat agent loop and the /api/mcp endpoint.
 * File prefixed with _ so Netlify does not treat it as a function.
 *
 * Tools follow the Model Context Protocol (MCP) shape:
 *   { name, description, inputSchema }
 * and are converted to OpenAI-style `tools` for the Sarvam chat API.
 */
const { rpc } = require('./_utils');

const SARVAM_API_BASE = 'https://api.sarvam.ai/v1';

// ─────────────────────────────────────────────────────────────
// Board helpers
// ─────────────────────────────────────────────────────────────
function boardKey(tiles) { return tiles.join(','); }

function manhattan(tiles, size) {
  let d = 0;
  for (let i = 0; i < tiles.length; i++) {
    const v = tiles[i];
    if (v === 0) continue;
    const goal = v - 1;
    d += Math.abs(Math.floor(i / size) - Math.floor(goal / size)) +
         Math.abs((i % size) - (goal % size));
  }
  return d;
}

function blankNeighbors(tiles, size) {
  const blank = tiles.indexOf(0);
  const r = Math.floor(blank / size);
  const c = blank % size;
  const out = [];
  if (r > 0) out.push(blank - size);
  if (r < size - 1) out.push(blank + size);
  if (c > 0) out.push(blank - 1);
  if (c < size - 1) out.push(blank + 1);
  return out;
}

function isSolvedBoard(tiles) {
  for (let i = 0; i < tiles.length - 1; i++) {
    if (tiles[i] !== i + 1) return false;
  }
  return tiles[tiles.length - 1] === 0;
}

function isSolvableBoard(tiles, size) {
  let inversions = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === 0) continue;
    for (let j = i + 1; j < tiles.length; j++) {
      if (tiles[j] !== 0 && tiles[i] > tiles[j]) inversions++;
    }
  }
  if (size % 2 !== 0) return inversions % 2 === 0;
  const blankIdx = tiles.indexOf(0);
  const rowFromBottom = size - Math.floor(blankIdx / size);
  return (inversions + rowFromBottom) % 2 !== 0;
}

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node) {
    const a = this.a;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    if (!a.length) return null;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Bounded A* solver. Returns [{tile, direction, index}] or null when the
 * node budget is exhausted (large boards).
 */
function solveBoard(startTiles, size, budget = 40000) {
  const start = [...startTiles];
  if (isSolvedBoard(start)) return [];
  const seen = new Set([boardKey(start)]);
  const heap = new MinHeap();
  heap.push({ tiles: start, g: 0, f: manhattan(start, size), path: [] });

  let expanded = 0;
  while (heap.size && expanded < budget) {
    const cur = heap.pop();
    if (isSolvedBoard(cur.tiles)) return cur.path;
    expanded++;
    const blank = cur.tiles.indexOf(0);
    for (const idx of blankNeighbors(cur.tiles, size)) {
      const next = [...cur.tiles];
      [next[idx], next[blank]] = [next[blank], next[idx]];
      const key = boardKey(next);
      if (seen.has(key)) continue;
      seen.add(key);
      const tile = cur.tiles[idx];
      const direction = blank === idx - size ? 'up'
        : blank === idx + size ? 'down'
        : blank === idx - 1 ? 'left'
        : 'right';
      heap.push({
        tiles: next,
        g: cur.g + 1,
        f: cur.g + 1 + manhattan(next, size),
        path: cur.path.concat([{ tile, direction, index: idx }]),
      });
    }
  }
  return null;
}

/** Greedy 1-ply fallback: the legal move that most reduces Manhattan distance. */
function greedyHint(tiles, size) {
  const blank = tiles.indexOf(0);
  let best = null;
  for (const idx of blankNeighbors(tiles, size)) {
    const next = [...tiles];
    [next[idx], next[blank]] = [next[blank], next[idx]];
    const h = manhattan(next, size);
    if (!best || h < best.h) {
      const direction = blank === idx - size ? 'up'
        : blank === idx + size ? 'down'
        : blank === idx - 1 ? 'left'
        : 'right';
      best = { h, move: { tile: tiles[idx], direction, index: idx } };
    }
  }
  return best ? best.move : null;
}

function sanitizeBoard(value, size) {
  const n = size * size;
  if (!Array.isArray(value) || value.length !== n) return null;
  const seen = new Set();
  for (const v of value) {
    if (!Number.isInteger(v) || v < 0 || v >= n || seen.has(v)) return null;
    seen.add(v);
  }
  return value;
}

// ─────────────────────────────────────────────────────────────
// Sarvam Translate (used by the translate_text tool)
// ─────────────────────────────────────────────────────────────
const LANG_CODE_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

async function sarvamTranslate(text, sourceCode, targetCode, apiKey) {
  const resp = await fetch(`${SARVAM_API_BASE}/translate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-subscription-key': apiKey,
    },
    body: JSON.stringify({
      input: text,
      source_language_code: sourceCode,
      target_language_code: targetCode,
      speaker_gender: 'Female',
      mode: 'classic',
      numerals_format: 'international',
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Translate API ${resp.status}: ${detail.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.translated_text || '';
}

// ─────────────────────────────────────────────────────────────
// MCP tool registry
// ─────────────────────────────────────────────────────────────
const GAME_INFO = {
  name: 'Neon Slide',
  description: 'Cyberpunk tile sliding puzzle. Slide tiles into the gap until they read 1..N with the empty gap last.',
  boardSizes: [3, 4, 5, 6, 10],
  rules: [
    'Click/tap a tile adjacent to the gap, drag it, or use arrow keys to slide it into the gap.',
    'Tiles arranged as 1,2,3...N with the gap (0) last wins.',
    'Correctly placed tiles glow gold.',
    'Fewer moves = more stars. Leaderboard ranks by fewest moves, ties by fastest time.',
  ],
  tips: [
    'Solve the first row, then the first column, and work inward on bigger boards.',
    '3x3: ~30 moves is great. 4x4: ~80 moves. Bigger boards are endurance runs.',
    'Watch the gold glow to know which tiles are already locked in place.',
  ],
};

const TOOLS = [
  {
    name: 'get_game_info',
    description: 'Get Neon Slide game rules, board sizes, scoring system and strategy tips.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    label: 'game rules',
  },
  {
    name: 'get_leaderboard',
    description: 'Get the live leaderboard for a board size (top ranked players by fewest moves).',
    inputSchema: {
      type: 'object',
      properties: {
        size: { type: 'integer', enum: [3, 4, 5, 6, 10], description: 'Board size. Default 4.' },
      },
      additionalProperties: false,
    },
    label: 'leaderboard',
  },
  {
    name: 'get_my_best',
    description: "Get the current logged-in player's best score (fewest moves) for a board size.",
    inputSchema: {
      type: 'object',
      properties: {
        size: { type: 'integer', enum: [3, 4, 5, 6, 10], description: 'Board size. Default 4.' },
      },
      additionalProperties: false,
    },
    label: 'my best score',
  },
  {
    name: 'analyze_board',
    description: 'Analyze the current puzzle board: solved tiles count, Manhattan distance to goal, solvability and completion percentage. Uses the live board from the page when no board is provided.',
    inputSchema: {
      type: 'object',
      properties: {
        board: {
          type: 'array',
          items: { type: 'integer' },
          description: 'Optional board as tile numbers row-major with 0 for the gap. Defaults to the player\'s live board.',
        },
        size: { type: 'integer', enum: [3, 4, 5, 6, 10], description: 'Board size. Default 4.' },
      },
      additionalProperties: false,
    },
    label: 'board analysis',
  },
  {
    name: 'get_next_move_hint',
    description: 'Suggest the next best move for the current puzzle. Uses an A* solver on small boards and a Manhattan-heuristic on big ones. Uses the live board from the page when no board is provided.',
    inputSchema: {
      type: 'object',
      properties: {
        board: {
          type: 'array',
          items: { type: 'integer' },
          description: 'Optional board as tile numbers row-major with 0 for the gap. Defaults to the player\'s live board.',
        },
        size: { type: 'integer', enum: [3, 4, 5, 6, 10], description: 'Board size. Default 4.' },
      },
      additionalProperties: false,
    },
    label: 'next move hint',
  },
  {
    name: 'translate_text',
    description: 'Translate text between languages (all 22 scheduled Indian languages + English and many more) using the Sarvam AI Translate API.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to translate (max 400 characters).' },
        source_language_code: { type: 'string', description: 'BCP-47 code such as "auto", "hi-IN", "ta-IN", "en-IN". Default "auto".' },
        target_language_code: { type: 'string', description: 'BCP-47 code such as "hi-IN", "ta-IN", "en-IN". Default "en-IN".' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    label: 'translate',
  },
];

/** MCP manifest (MCP shape: name/description/inputSchema). */
function mcpTools() {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

/** Same tools in OpenAI/Sarvam `tools` format. */
function openAiTools() {
  return TOOLS.map(({ name, description, inputSchema }) => ({
    type: 'function',
    function: { name, description, parameters: inputSchema },
  }));
}

function toolLabel(name) {
  const t = TOOLS.find((t) => t.name === name);
  return t ? t.label : name;
}

// ─────────────────────────────────────────────────────────────
// Tool executor
// ctx = { user, game_context, apiKey }
// ─────────────────────────────────────────────────────────────
async function executeTool(name, rawArgs, ctx) {
  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs : {};
  const game = ctx && ctx.game_context ? ctx.game_context : {};

  switch (name) {
    case 'get_game_info':
      return GAME_INFO;

    case 'get_leaderboard': {
      const size = [3, 4, 5, 6, 10].includes(args.size) ? args.size : 4;
      const rows = await rpc('neonslide_get_leaderboard', { p_size: size });
      const arr = Array.isArray(rows) ? rows : [];
      return {
        size,
        leaderboard: arr.slice(0, 10).map((e, i) => ({
          rank: i + 1,
          player: e.username,
          moves: e.moves,
          timeSeconds: Math.round((e.elapsed_ms || 0) / 100) / 10,
        })),
      };
    }

    case 'get_my_best': {
      if (!ctx.user || !ctx.user.username) {
        return { error: 'The player is not logged in. Ask them to log in first to see their best scores.' };
      }
      const size = [3, 4, 5, 6, 10].includes(args.size) ? args.size : 4;
      const best = await rpc('neonslide_get_best', { p_user_id: ctx.user.sub, p_size: size });
      return {
        player: ctx.user.username,
        size,
        bestMoves: best && best.moves != null ? best.moves : null,
      };
    }

    case 'analyze_board':
    case 'get_next_move_hint': {
      const size = [3, 4, 5, 6, 10].includes(args.size) ? args.size : (game.size || 4);
      const board = sanitizeBoard(args.board, size) || sanitizeBoard(game.board, size);
      if (!board) {
        return { error: 'No valid board available. The player may not have a game in progress.' };
      }
      const solvedCount = board.reduce((acc, v, i) => acc + (v !== 0 && v === i + 1 ? 1 : 0), 0);
      const total = size * size - 1;

      if (name === 'analyze_board') {
        return {
          size,
          solvedTiles: solvedCount,
          totalTiles: total,
          percentSolved: Math.round((solvedCount / total) * 100),
          manhattanDistance: manhattan(board, size),
          solvable: isSolvableBoard(board, size),
          solved: isSolvedBoard(board),
          player: ctx.user && ctx.user.username ? ctx.user.username : 'guest',
          movesSoFar: typeof game.moves === 'number' ? game.moves : null,
        };
      }

      // get_next_move_hint
      if (isSolvedBoard(board)) {
        return { solved: true, message: 'The board is already solved! Start a new game to keep playing.' };
      }
      let plan = size <= 4 ? solveBoard(board, size, 40000) : null;
      if (plan && plan.length) {
        return {
          method: 'A* solver (optimal)',
          nextMove: { tile: plan[0].tile, direction: plan[0].direction },
          nextFewMoves: plan.slice(0, 5).map((m) => `slide tile ${m.tile} ${m.direction}`),
          optimalMovesLeft: plan.length,
        };
      }
      const greedy = greedyHint(board, size);
      return {
        method: 'heuristic (board too large for exact solve)',
        nextMove: greedy ? { tile: greedy.tile, direction: greedy.direction } : null,
        note: 'This board is big, so this is a greedy hint, not the provably optimal move.',
      };
    }

    case 'translate_text': {
      const text = typeof args.text === 'string' ? args.text.trim().slice(0, 400) : '';
      if (!text) return { error: 'Nothing to translate.' };
      const source = typeof args.source_language_code === 'string' && LANG_CODE_RE.test(args.source_language_code)
        ? args.source_language_code : 'auto';
      let target = typeof args.target_language_code === 'string' && LANG_CODE_RE.test(args.target_language_code)
        ? args.target_language_code : 'en-IN';
      if (target === source) target = 'en-IN';
      if (!ctx.apiKey) return { error: 'Translation is not configured (missing API key).' };
      const translated = await sarvamTranslate(text, source, target, ctx.apiKey);
      return { source, target, translated };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

module.exports = { mcpTools, openAiTools, toolLabel, executeTool, GAME_INFO };
