# Neon Slide — Cyberpunk Tile Puzzle

A cyberpunk-themed sliding tile puzzle game (3×3 to 10×10) with accounts, a live
leaderboard, and **NeonBot** — an in-game AI chat companion powered by
**Sarvam AI** with **MCP-style tool calling**.

Live site: https://neonslide.netlify.app/

## Architecture

- **Frontend** — plain HTML/CSS/JS (`index.html`, `scoring.js`, `chat.js`).
- **Backend** — Netlify Functions in `netlify/functions/`:

  | Function | Purpose |
  |---|---|
  | `auth.js` | login / signup / logout (JWT cookie) |
  | `scores.js` | ranked boards, move verification, leaderboard |
  | `chat.js` | NeonBot AI chat — calls Sarvam AI and runs an agentic tool-calling loop |
  | `mcp.js` | MCP-style JSON-RPC endpoint (`tools/list`, `tools/call`) exposing NeonBot's tools to any MCP client |
  | `_utils.js` | shared helpers (Supabase RPC, JWT, cookies) |
  | `_mcp-tools.js` | MCP tool registry + executor shared by `chat.js` and `mcp.js` |

All functions are reachable under `/api/*` (see `netlify.toml` redirects).

## NeonBot's MCP-style tools

| Tool | What it does |
|---|---|
| `get_game_info` | rules, board sizes, scoring, strategy tips |
| `get_leaderboard` | live leaderboard for any board size |
| `get_my_best` | logged-in player's best score |
| `analyze_board` | solved tiles, Manhattan distance, solvability of the live board |
| `get_next_move_hint` | optimal next move via A* (heuristic on huge boards) |
| `translate_text` | Sarvam AI translation (22 Indian languages + more) |

Try the MCP endpoint directly:

```bash
curl https://neonslide.netlify.app/api/mcp | jq
curl -X POST https://neonslide.netlify.app/api/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
curl -X POST https://neonslide.netlify.app/api/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_leaderboard","arguments":{"size":4}}}'
```

## Environment variables (Netlify → Site configuration → Environment variables)

| Variable | Required | Purpose |
|---|---|---|
| `SARVAM_API_KEY` | yes | Sarvam AI API key (server-side only, never exposed to the browser) |
| `SARVAM_MODEL` | no | Chat model, default `sarvam-m` |
| `SUPABASE_URL` | no | Defaults to the project URL |
| `SUPABASE_ANON_KEY` | no | Defaults to the project anon key |
| `JWT_SECRET` | recommended | Secret for session cookies |

Never commit API keys to this repository — set them in the Netlify dashboard.

## Deployment

The site auto-deploys from the `main` branch on GitHub to Netlify.
