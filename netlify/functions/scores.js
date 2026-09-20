/**
 * Neon Slide — Scores API
 * Handles: GET leaderboard, POST start game, POST finish game
 */
const { rpc, getUserFromEvent, json } = require('./_utils');

// ── Board generation (mirrors frontend logic) ──
function isSolvable(tiles, size) {
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

function isSolved(tiles) {
  for (let i = 0; i < tiles.length - 1; i++) {
    if (tiles[i] !== i + 1) return false;
  }
  return tiles[tiles.length - 1] === 0;
}

function generateSolvableBoard(size) {
  const n = size * size;
  let tiles;
  let attempts = 0;
  do {
    tiles = Array.from({ length: n }, (_, i) => (i + 1) % n);
    for (let i = tiles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    }
    attempts++;
  } while ((!isSolvable(tiles, size) || isSolved(tiles)) && attempts < 200);
  return tiles;
}

// ── Verify move sequence solves the puzzle ──
function verifyMoves(board, moves, size) {
  const tiles = [...board];
  let emptyIdx = tiles.indexOf(0);

  for (const tileIdx of moves) {
    if (tileIdx < 0 || tileIdx >= tiles.length) return false;
    const rowDiff = Math.abs(Math.floor(tileIdx / size) - Math.floor(emptyIdx / size));
    const colDiff = Math.abs((tileIdx % size) - (emptyIdx % size));
    if (rowDiff + colDiff !== 1) return false; // must be adjacent
    [tiles[tileIdx], tiles[emptyIdx]] = [tiles[emptyIdx], tiles[tileIdx]];
    emptyIdx = tileIdx;
  }

  return isSolved(tiles);
}

exports.handler = async (event) => {
  // ── GET: leaderboard + best score ──
  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters || {};
    const size = parseInt(params.size) || 4;

    const leaderboard = await rpc('neonslide_get_leaderboard', { p_size: size });
    const arr = Array.isArray(leaderboard) ? leaderboard : [];

    const user = getUserFromEvent(event);
    let best = null;
    if (user) {
      const bestResult = await rpc('neonslide_get_best', { p_user_id: user.sub, p_size: size });
      if (bestResult && bestResult.moves != null) {
        best = bestResult.moves;
      }
    }

    return json(200, {
      best,
      leaderboard: arr.map(e => ({
        username: e.username,
        moves: e.moves,
        elapsedMs: e.elapsed_ms,
        elapsedMs_raw: e.elapsed_ms,
      })),
    });
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }

  const user = getUserFromEvent(event);
  const action = body.action;

  // ── START ranked game ──
  if (action === 'start') {
    if (!user) {
      return json(401, { error: 'You must be logged in to play ranked games.' });
    }

    const size = parseInt(body.size) || 4;
    if (![3, 4, 5, 6, 10].includes(size)) {
      return json(400, { error: 'Invalid board size.' });
    }

    const board = generateSolvableBoard(size);
    const gameId = await rpc('neonslide_create_game', {
      p_user_id: user.sub,
      p_size: size,
      p_board: JSON.stringify(board),
    });

    if (!gameId) {
      return json(500, { error: 'Failed to create game. Please try again.' });
    }

    return json(200, { id: gameId, board });
  }

  // ── FINISH ranked game (verify + save score) ──
  if (action === 'finish') {
    if (!user) {
      return json(401, { error: 'You must be logged in to save scores.' });
    }

    const { id: gameId, moves: moveHistory } = body;
    if (!gameId || !Array.isArray(moveHistory)) {
      return json(400, { error: 'Game ID and move history are required.' });
    }

    // Load the game
    const game = await rpc('neonslide_get_game', { p_game_id: gameId });
    // Idempotent retry: if the first save committed but the browser lost
    // its response, Retry must report success instead of failing.
    if (game && game.completed === true) {
      return json(200, { message: 'Score was already saved.' });
    }
    if (!game || !game.board) {
      return json(404, { error: 'Game not found.' });
    }

    // Parse board from JSONB
    const board = typeof game.board === 'string' ? JSON.parse(game.board) : game.board;
    const size = game.size;

    // Verify the moves solve the puzzle
    if (!verifyMoves(board, moveHistory, size)) {
      return json(400, { error: 'Move verification failed. Score not saved.' });
    }

    // Calculate stats
    const moveCount = moveHistory.length;

    // Get elapsed time from game creation
    const gameInfo = await rpc('neonslide_get_game_time', { p_game_id: gameId });
    const elapsedMs = gameInfo && gameInfo.elapsed_ms ? gameInfo.elapsed_ms : 0;

    const success = await rpc('neonslide_finish_game', {
      p_game_id: gameId,
      p_user_id: user.sub,
      p_moves: moveCount,
      p_elapsed_ms: elapsedMs,
    });

    if (success !== true) {
      return json(500, { error: 'Failed to save score.' });
    }

    return json(200, { message: 'Score verified and saved.' });
  }

  return json(400, { error: 'Unknown action.' });
};
