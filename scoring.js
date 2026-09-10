let scoringUser = null;
let rankedGame = null;
let moveHistory = [];
let pendingScore = null;
let gameGeneration = 0;
const accountMessage = document.getElementById('account-message');
const scoreMessage = document.getElementById('score-message');
const accountForm = document.getElementById('account-form');
let authMode = 'login';
let recoveryToken = null;
async function api(path, data) {
    const response = await fetch('/api/' + path, {
        method: data ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: data ? { 'Content-Type': 'application/json' } : {},
        body: data ? JSON.stringify(data) : undefined,
        signal: AbortSignal.timeout(15000)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Request failed. Please retry.');
    return result;
}
function setAuthMode(mode) {
    authMode = mode;
    document.getElementById('account-username-label').hidden = !['login', 'signup'].includes(mode);
    document.getElementById('account-username').required = ['login', 'signup'].includes(mode);
    document.getElementById('account-email-label').hidden = !['signup', 'recover'].includes(mode);
    document.getElementById('account-email').required = ['signup', 'recover'].includes(mode);
    document.getElementById('account-password-label').hidden = mode === 'recover';
    const password = document.getElementById('account-password');
    password.required = mode !== 'recover';
    password.minLength = mode === 'login' ? 1 : 12;
    password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    password.value = '';
    document.getElementById('account-submit').textContent = { login:'Log in', signup:'Create account', recover:'Send reset email', reset:'Set new password' }[mode];
    accountMessage.textContent = mode === 'signup' ? 'Username: 3–24 letters, numbers or underscores. Password: at least 12 characters. Email is private and used for verification and recovery.' : '';
}
document.querySelectorAll('[data-auth-mode]').forEach(button => button.addEventListener('click', () => setAuthMode(button.dataset.authMode)));
accountForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = document.getElementById('account-submit'); button.disabled = true;
    accountMessage.textContent = 'Processing…';
    try {
        const result = await api('auth', { action:authMode, username:document.getElementById('account-username').value,
            email:document.getElementById('account-email').value, password:document.getElementById('account-password').value, token:recoveryToken });
        document.getElementById('account-password').value = '';
        if (['login', 'reset'].includes(authMode)) { window.location.replace('/'); return; }
        accountMessage.textContent = result.message;
    } catch (error) { accountMessage.textContent = error.message; }
    finally { button.disabled = false; }
});
document.getElementById('account-logout').addEventListener('click', async () => {
    try { await api('auth', { action:'logout' }); window.location.replace('/'); }
    catch (error) { accountMessage.textContent = error.message; }
});
const scoringReady = (async () => {
    try {
        const hash = new URLSearchParams(location.hash.slice(1));
        if (hash.has('confirmation_token')) {
            const token = hash.get('confirmation_token'); history.replaceState(null, '', location.pathname);
            await api('auth', { action:'confirm', token }); window.location.replace('/'); return;
        }
        if (hash.has('recovery_token')) {
            recoveryToken = hash.get('recovery_token'); history.replaceState(null, '', location.pathname);
            setAuthMode('reset'); document.getElementById('account-details').open = true;
            return;
        }
        const result = await api('auth'); scoringUser = result.username;
        document.getElementById('account-summary').textContent = scoringUser ? 'Playing as ' + scoringUser : 'Log in or create a scoring account';
        accountForm.hidden = !!scoringUser;
        document.getElementById('account-modes').hidden = !!scoringUser;
        document.getElementById('account-logout').hidden = !scoringUser;
    } catch { accountMessage.textContent = 'Accounts are temporarily unavailable. Guest play is still available.'; }
})();
let leaderboardRequest = 0;
async function refreshLeaderboard() {
    const request = ++leaderboardRequest;
    const size = state.gridSize;
    document.getElementById('leaderboard-size').textContent = `${size}×${size}`;
    try {
        const result = await api('scores?size=' + size);
        if (request !== leaderboardRequest || size !== state.gridSize) return;
        els.bestScore.textContent = result.best ?? '-';
        const rows = document.getElementById('leaderboard-rows'); rows.replaceChildren();
        result.leaderboard.forEach((entry, index) => {
            const row = document.createElement('tr');
            const seconds = Math.floor(entry.elapsedMs / 1000);
            for (const value of [index + 1, entry.username, entry.moves, `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')}`]) {
                const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell);
            }
            rows.appendChild(row);
        });
        document.getElementById('leaderboard-status').textContent = result.leaderboard.length ? 'Live · refreshes every 10 seconds' : 'No completed games yet. Be the first to solve this size.';
    } catch { if (request === leaderboardRequest) document.getElementById('leaderboard-status').textContent = 'Leaderboard unavailable. Retrying automatically…'; }
}
async function submitRankedScore() {
    if (!rankedGame) { scoreMessage.textContent = 'Guest game completed. Log in and start a new game to rank.'; return; }
    const submission = { action:'finish', id:rankedGame, moves:[...moveHistory] };
    pendingScore = submission;
    await sendScore(submission);
}
async function sendScore(submission) {
    const retry = document.getElementById('retry-score'); retry.disabled = true;
    scoreMessage.textContent = 'Verifying and saving your score…';
    try {
        await api('scores', submission);
        if (pendingScore === submission) pendingScore = null;
        scoreMessage.textContent = 'Verified score saved.'; retry.hidden = true;
        await refreshLeaderboard();
    } catch (error) { scoreMessage.textContent = error.message + ' Use Retry to save this completed game.'; retry.hidden = false; }
    finally { retry.disabled = false; }
}
document.getElementById('retry-score').addEventListener('click', () => { if (pendingScore) sendScore(pendingScore); });
setInterval(() => { if (!document.hidden) refreshLeaderboard(); }, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshLeaderboard(); });
