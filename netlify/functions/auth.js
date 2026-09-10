/**
 * Neon Slide — Auth API
 * Handles: signup, login, logout, recover, reset, confirm, GET (session check)
 */
const { rpc, getUserFromEvent, makeCookie, clearCookie, json } = require('./_utils');

exports.handler = async (event) => {
  // ── GET: check session ──
  if (event.httpMethod === 'GET') {
    const user = getUserFromEvent(event);
    return json(200, { username: user ? user.username : null });
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

  const action = body.action;

  // ── GET session info (also works via POST without action) ──
  if (!action) {
    const user = getUserFromEvent(event);
    return json(200, { username: user ? user.username : null });
  }

  // ── LOGIN ──
  if (action === 'login') {
    const { username, password } = body;
    if (!username || !password) return json(400, { error: 'Username and password are required.' });

    const userId = await rpc('neonslide_login', { p_username: username, p_password: password });

    if (!userId) {
      return json(401, { error: 'Invalid username or password.' });
    }

    return json(200, { message: 'Logged in.' }, {
      'Set-Cookie': makeCookie(userId, username),
    });
  }

  // ── SIGNUP ──
  if (action === 'signup') {
    const { username, email, password } = body;
    if (!username || !email || !password) {
      return json(400, { error: 'Username, email and password are all required.' });
    }
    if (username.length < 3 || username.length > 24) {
      return json(400, { error: 'Username must be 3–24 characters.' });
    }
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
      return json(400, { error: 'Username may only contain letters, numbers and underscores.' });
    }
    if (password.length < 12) {
      return json(400, { error: 'Password must be at least 12 characters.' });
    }

    const userId = await rpc('neonslide_signup', {
      p_username: username,
      p_email: email,
      p_password: password,
    });

    if (!userId) {
      return json(409, { error: 'Username or email already exists.' });
    }

    // Auto-login after signup (no email confirmation needed for a game)
    return json(200, { message: 'Account created! You are now logged in.' }, {
      'Set-Cookie': makeCookie(userId, username),
    });
  }

  // ── LOGOUT ──
  if (action === 'logout') {
    return json(200, { message: 'Logged out.' }, {
      'Set-Cookie': clearCookie(),
    });
  }

  // ── RECOVER (forgot password) ──
  if (action === 'recover') {
    const { email } = body;
    if (!email) return json(400, { error: 'Email is required.' });

    const result = await rpc('neonslide_recover_by_email', { p_email: email });

    if (result && result.token) {
      const link = `https://neonslide.netlify.app/#recovery_token=${result.token}`;
      return json(200, {
        message: `Recovery link generated. Click here to reset your password: ${link}`,
      });
    }

    return json(200, {
      message: 'If an account exists for that email, a recovery link has been generated. Ask the admin if you did not receive it.',
    });
  }

  // ── RESET (set new password with token) ──
  if (action === 'reset') {
    const { password, token } = body;
    if (!password || !token) {
      return json(400, { error: 'Password and reset token are required.' });
    }
    if (password.length < 12) {
      return json(400, { error: 'Password must be at least 12 characters.' });
    }

    const success = await rpc('neonslide_reset_password', {
      p_token: token,
      p_new_password: password,
    });

    if (success !== true) {
      return json(400, { error: 'Invalid or expired reset token. Please request a new one.' });
    }

    return json(200, { message: 'Password updated. You can now log in.' });
  }

  // ── CONFIRM (email confirmation — auto-confirmed on signup, so just return ok) ──
  if (action === 'confirm') {
    return json(200, { message: 'Email confirmed.' });
  }

  return json(400, { error: 'Unknown action.' });
};
