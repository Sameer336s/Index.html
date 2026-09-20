/**
 * Shared utilities for Neon Slide Netlify Functions.
 * File prefixed with _ so Netlify does not treat it as a function.
 */
const crypto = require('crypto');

// ── Supabase config (publishable / anon key — safe for client-side) ──
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const JWT_SECRET = process.env.JWT_SECRET || 'neonslide-secret-key-2026-change-me';
const COOKIE_NAME = 'neonslide_session';

// ── Minimal JWT (HS256) using Node crypto ──
function base64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function signJWT(payload, ttlDays = 30) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlDays * 86400,
  }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJWT(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Supabase RPC helper ──
async function rpc(name, params = {}) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(params),
  });
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ── Cookie helpers ──
function parseCookies(event) {
  const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
  const cookies = {};
  cookieHeader.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) cookies[k] = v.join('=');
  });
  return cookies;
}

function getUserFromEvent(event) {
  const cookies = parseCookies(event);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const payload = verifyJWT(token);
  return payload;
}

function makeCookie(userId, username) {
  const token = signJWT({ sub: userId, username });
  const secure = process.env.NETLIFY ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax${secure}`;
}

function clearCookie() {
  const secure = process.env.NETLIFY ? '; Secure' : '';
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

// ── Response helpers ──
function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  };
}

module.exports = {
  rpc, signJWT, verifyJWT,
  parseCookies, getUserFromEvent,
  makeCookie, clearCookie,
  json, COOKIE_NAME,
};
