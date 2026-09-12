/**
 * NEON SLIDE — NeonBot, the in-game AI companion.
 * Powered by Sarvam AI through a Netlify Function (MCP-style tool calling)
 * (the API key stays server-side and is never exposed to the browser).
 *
 * Self-contained: injects its own styles + widget markup, then wires it up.
 */
(function () {
    'use strict';

    var ENDPOINT = '/api/chat';
    var STORAGE_KEY = 'neonslide_chat_v1';
    var SESSION_KEY = 'neonslide_session_v1';
    var WELCOME = 'Hey! I\'m NeonBot, your Neon Slide companion — powered by Sarvam AI. Ask me how to play, request strategy tips, or chat in any language you like.';
    var MAX_STORED = 24;   // messages kept in localStorage
    var MAX_SENT = 12;     // messages sent to the model

    // ── Styles (scoped to .chat-* / #chat-*) ──
    var CSS = [
        '.chat-fab{position:fixed;right:18px;bottom:18px;width:54px;height:54px;border-radius:16px;',
        'background:linear-gradient(135deg,var(--gold,#c9a96e),#a88950);border:1px solid rgba(255,255,255,.12);',
        'color:#1a1408;cursor:pointer;display:flex;align-items:center;justify-content:center;',
        'box-shadow:0 6px 24px rgba(201,169,110,.35);transition:transform .2s ease,box-shadow .2s ease;',
        'z-index:300;padding:0}',
        '.chat-fab:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(201,169,110,.5)}',
        '.chat-fab svg{width:24px;height:24px}',
        '.chat-panel{position:fixed;right:18px;bottom:84px;width:min(372px,calc(100vw - 28px));',
        'max-height:min(560px,calc(100vh - 116px));display:flex;flex-direction:column;',
        'background:var(--bg-elev,#15121f);border:1px solid var(--border-strong,rgba(201,169,110,.3));',
        'border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.6);z-index:310;opacity:0;',
        'transform:translateY(12px) scale(.98);pointer-events:none;transition:opacity .25s ease,transform .25s ease}',
        '.chat-panel.open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}',
        '.chat-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border,rgba(201,169,110,.14))}',
        '.chat-head-icon{width:34px;height:34px;border-radius:10px;flex:none;',
        'background:var(--tile-correct,rgba(201,169,110,.08));border:1px solid var(--gold,#c9a96e);',
        'display:flex;align-items:center;justify-content:center;color:var(--gold-bright,#e0c890);font-size:.9rem}',
        '.chat-head-text{flex:1;min-width:0}',
        '.chat-head-title{font-size:.85rem;font-weight:600;letter-spacing:.5px;color:var(--text,#ece8e0)}',
        '.chat-head-sub{font-size:.6rem;color:var(--text-dim,#8b8497);letter-spacing:1px;text-transform:uppercase;',
        'display:flex;align-items:center;gap:5px;margin-top:2px}',
        '.chat-head-sub::before{content:\'\';width:6px;height:6px;border-radius:50%;background:#7bb881;',
        'box-shadow:0 0 6px #7bb881;flex:none}',
        '.chat-head-actions{display:flex;gap:6px}',
        '.chat-head-actions button{width:28px;height:28px;padding:0;border-radius:7px;font-size:.8rem;',
        'letter-spacing:0;text-transform:none;font-weight:400}',
        '.chat-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;',
        'scrollbar-width:thin;scrollbar-color:var(--border-strong,rgba(201,169,110,.3)) transparent;min-height:180px;user-select:text}',
        '.chat-msg{max-width:86%;font-size:.82rem;line-height:1.55}',
        '.chat-msg .chat-bubble{padding:9px 12px;border-radius:12px;border:1px solid var(--border,rgba(201,169,110,.14));',
        'background:var(--panel,#181423);color:var(--text,#ece8e0);white-space:pre-wrap;overflow-wrap:anywhere;text-align:left}',
        '.chat-msg.user{align-self:flex-end;text-align:right}',
        '.chat-msg.user .chat-bubble{background:linear-gradient(135deg,rgba(201,169,110,.16),rgba(201,169,110,.08));',
        'border-color:var(--border-strong,rgba(201,169,110,.3));color:var(--gold-bright,#e0c890)}',
        '.chat-msg .chat-meta{font-size:.58rem;color:var(--text-dim,#8b8497);margin-top:3px;letter-spacing:.5px}',
        '.chat-msg.error .chat-bubble{border-color:rgba(199,123,123,.5);color:var(--rose,#c77b7b)}',
        '.chat-anim{animation:chatIn .25s ease}',
        '@keyframes chatIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}',
        '.chat-typing{display:inline-flex;gap:4px;padding:12px;align-items:center}',
        '.chat-typing span{width:6px;height:6px;border-radius:50%;background:var(--gold,#c9a96e);animation:chatBounce 1.2s infinite;opacity:.4}',
        '.chat-typing span:nth-child(2){animation-delay:.15s}',
        '.chat-typing span:nth-child(3){animation-delay:.3s}',
        '@keyframes chatBounce{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-4px);opacity:1}}',
        '.chat-chips{display:flex;gap:6px;padding:0 14px 10px;flex-wrap:wrap}',
        '.chat-chip{padding:6px 10px;border-radius:999px;font-size:.68rem;border:1px solid var(--border,rgba(201,169,110,.14));',
        'background:transparent;color:var(--text-dim,#8b8497);cursor:pointer;transition:all .2s ease;',
        'letter-spacing:.2px;text-transform:none;font-weight:400}',
        '.chat-chip:hover{color:var(--gold-bright,#e0c890);border-color:var(--gold,#c9a96e)}',
        '.chat-input-row{display:flex;gap:8px;padding:12px 14px;border-top:1px solid var(--border,rgba(201,169,110,.14))}',
        '.chat-input-row input{flex:1;min-width:0;padding:10px 12px;background:var(--bg,#0c0a14);color:var(--text,#ece8e0);',
        'border:1px solid var(--border-strong,rgba(201,169,110,.3));border-radius:9px;font:inherit;font-size:.82rem;user-select:text}',
        '.chat-input-row input:focus-visible{outline:2px solid var(--gold,#c9a96e);outline-offset:1px}',
        '.chat-send{width:42px;padding:0;border-radius:9px;flex:none;',
        'background:linear-gradient(135deg,var(--gold,#c9a96e),#a88950);border:none;color:#1a1408;font-weight:600;font-size:.9rem}',
        '.chat-tools{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px}',
        '.chat-tool-badge{font-size:.58rem;color:var(--gold);background:rgba(201,169,110,.08);border:1px solid rgba(201,169,110,.2);padding:2px 6px;border-radius:999px;letter-spacing:.3px;text-transform:uppercase}',
        '@media (max-width:480px){.chat-panel{right:14px;bottom:78px;max-height:calc(100vh - 100px)}.chat-fab{right:14px;bottom:14px}}'
    ].join('');

    function injectStyles() {
        var style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    // ── Widget markup ──
    var CHAT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>' +
        '<path d="M8 9.5h.01M12 9.5h.01M16 9.5h.01"></path></svg>';

    var MARKUP =
        '<button class="chat-fab" id="chat-fab" aria-label="Open NeonBot AI chat" aria-expanded="false" title="NeonBot AI">' + CHAT_ICON + '</button>' +
        '<div class="chat-panel" id="chat-panel" role="dialog" aria-label="NeonBot AI chat" aria-hidden="true">' +
        '<div class="chat-head">' +
        '<div class="chat-head-icon" aria-hidden="true">\u25C6</div>' +
        '<div class="chat-head-text"><div class="chat-head-title">NeonBot</div>' +
        '<div class="chat-head-sub">Sarvam AI &middot; online</div></div>' +
        '<div class="chat-head-actions">' +
        '<button type="button" id="chat-clear" title="Clear chat" aria-label="Clear chat history">\u2306</button>' +
        '<button type="button" id="chat-close" title="Close" aria-label="Close chat">\u2715</button>' +
        '</div></div>' +
        '<div class="chat-body" id="chat-messages" aria-live="polite"></div>' +
        '<div class="chat-chips" id="chat-chips">' +
        '<button type="button" class="chat-chip" data-msg="How do I play Neon Slide?">How do I play?</button>' +
        '<button type="button" class="chat-chip" data-msg="Give me strategy tips for the 4\u00D74 board.">Strategy tips</button>' +
        '<button type="button" class="chat-chip" data-msg="What par moves should I aim for on each board size?">Par moves?</button>' +
        '<button type="button" class="chat-chip" data-msg="\u092E\u0941\u091D\u0938\u0947 \u0939\u093F\u0902\u0926\u0940 \u092E\u0947\u0902 \u092C\u093E\u0924 \u0915\u0930\u094B\u0964">\u0939\u093F\u0902\u0926\u0940 \u092E\u0947\u0902 \u092C\u093E\u0924</button>' +
        '</div>' +
        '<form class="chat-input-row" id="chat-form">' +
        '<input type="text" id="chat-input" autocomplete="off" maxlength="1000" placeholder="Ask NeonBot anything\u2026" aria-label="Message NeonBot">' +
        '<button type="submit" class="chat-send" id="chat-send" aria-label="Send message">\u27A4</button>' +
        '</form></div>';

    function injectWidget() {
        var host = document.createElement('div');
        host.innerHTML = MARKUP;
        while (host.firstChild) document.body.appendChild(host.firstChild);
    }

    // ── Boot ──
    injectStyles();
    injectWidget();

    var els = {
        fab: document.getElementById('chat-fab'),
        panel: document.getElementById('chat-panel'),
        close: document.getElementById('chat-close'),
        clear: document.getElementById('chat-clear'),
        messages: document.getElementById('chat-messages'),
        form: document.getElementById('chat-form'),
        input: document.getElementById('chat-input'),
        send: document.getElementById('chat-send'),
        chips: document.getElementById('chat-chips')
    };

    var history = [];
    var isOpen = false;
    var busy = false;

    // ── Persistence ──
    function loadHistory() {
        try {
            var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            if (Array.isArray(raw)) {
                history = raw.filter(function (m) {
                    return m && (m.role === 'user' || m.role === 'bot') && typeof m.content === 'string';
                }).slice(-MAX_STORED);
            }
        } catch (e) { history = []; }
    }
    function saveHistory() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_STORED))); } catch (e) { /* storage full */ }
    }

    function getSessionId() {
        try {
            var sid = localStorage.getItem(SESSION_KEY);
            if (!sid) {
                sid = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
                localStorage.setItem(SESSION_KEY, sid);
            }
            return sid;
        } catch (e) { return null; }
    }

    // ── Rendering ──
    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }
    function timeLabel() {
        var d = new Date();
        var h = d.getHours(), m = d.getMinutes();
        return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
    }
    function renderMessage(msg, animate) {
        var wrap = el('div', 'chat-msg ' + (msg.role === 'user' ? 'user' : (msg.role === 'error' ? 'bot error' : 'bot')));
        if (animate) wrap.classList.add('chat-anim');
        wrap.appendChild(el('div', 'chat-bubble', msg.content));
        wrap.appendChild(el('div', 'chat-meta',
            (msg.role === 'user' ? 'you' : msg.role === 'error' ? 'error' : 'NeonBot') + ' \u00B7 ' + timeLabel()));
        els.messages.appendChild(wrap);
        els.messages.scrollTop = els.messages.scrollHeight;
    }
    function renderTyping() {
        var wrap = el('div', 'chat-msg bot');
        wrap.id = 'chat-typing';
        var dots = el('div', 'chat-typing');
        dots.appendChild(el('span'));
        dots.appendChild(el('span'));
        dots.appendChild(el('span'));
        wrap.appendChild(dots);
        els.messages.appendChild(wrap);
        els.messages.scrollTop = els.messages.scrollHeight;
    }
    function removeTyping() {
        var t = document.getElementById('chat-typing');
        if (t) t.remove();
    }

    // ── Live game context (sent with every message) ──
    function buildGameContext() {
        var ctx = {};
        try {
            if (typeof state !== 'undefined' && state) {
                ctx.size = state.gridSize;
                ctx.moves = state.moves;
                ctx.won = state.isWon === true;
                if (typeof state.startTime === 'number') {
                    var secs = Math.floor((Date.now() - state.startTime) / 1000);
                    if (secs >= 0 && secs < 86400) ctx.elapsedSeconds = secs;
                }
                if (Array.isArray(state.tiles) && state.tiles.length) {
                    var solved = 0;
                    for (var i = 0; i < state.tiles.length; i++) {
                        if (state.tiles[i] !== 0 && state.tiles[i] === i + 1) solved++;
                    }
                    ctx.solvedTiles = solved;
                    ctx.totalTiles = state.tiles.length - 1;
                }
            }
        } catch (e) { /* game state unavailable */ }
        try {
            if (typeof scoringUser !== 'undefined' && typeof scoringUser === 'string' && scoringUser) {
                ctx.player = scoringUser.slice(0, 24);
            }
        } catch (e) { /* not logged in */ }
        return ctx;
    }

    // ── API call ──
    function sendMessage(text) {
        var content = (text || '').trim();
        if (!content || busy) return;

        history.push({ role: 'user', content: content });
        renderMessage({ role: 'user', content: content }, true);
        saveHistory();

        busy = true;
        els.send.disabled = true;
        els.input.disabled = true;
        renderTyping();

        var payload = {
            messages: history.slice(-MAX_SENT).map(function (m) {
                return { role: m.role === 'user' ? 'user' : 'assistant', content: m.content };
            }),
            game_context: buildGameContext(),
            session_id: getSessionId()
        };

        fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(70000)
        })
            .then(function (res) {
                return res.json().then(function (data) { return { ok: res.ok, data: data }; });
            })
            .then(function (r) {
                removeTyping();
                if (r.ok && r.data && typeof r.data.reply === 'string' && r.data.reply.trim()) {
                    var reply = r.data.reply.trim();
                    history.push({ role: 'bot', content: reply });
                    renderMessage({ role: 'bot', content: reply }, true);
                    if (r.data.tools_used && r.data.tools_used.length) {
                        var lastMsg = els.messages.lastElementChild;
                        if (lastMsg) {
                            var tools = el('div', 'chat-tools');
                            r.data.tools_used.forEach(function(t) {
                                var badge = el('span', 'chat-tool-badge');
                                badge.textContent = '⚡ ' + t.label;
                                tools.appendChild(badge);
                            });
                            lastMsg.appendChild(tools);
                        }
                    }
                } else {
                    var err = (r.data && r.data.error) ? r.data.error : 'NeonBot is unreachable right now. Please try again.';
                    renderMessage({ role: 'error', content: err }, true);
                }
                saveHistory();
            })
            .catch(function () {
                removeTyping();
                renderMessage({ role: 'error', content: 'Connection lost. Check your internet and try again.' }, true);
            })
            .then(function () {
                busy = false;
                els.send.disabled = false;
                els.input.disabled = false;
                if (isOpen) els.input.focus();
            });
    }

    // ── Panel controls ──
    function openPanel() {
        isOpen = true;
        els.panel.classList.add('open');
        els.panel.setAttribute('aria-hidden', 'false');
        els.fab.setAttribute('aria-expanded', 'true');
        if (!els.messages.childNodes.length) {
            history.push({ role: 'bot', content: WELCOME });
            renderMessage({ role: 'bot', content: WELCOME }, false);
            saveHistory();
        }
        setTimeout(function () { els.input.focus(); }, 120);
    }
    function closePanel() {
        isOpen = false;
        els.panel.classList.remove('open');
        els.panel.setAttribute('aria-hidden', 'true');
        els.fab.setAttribute('aria-expanded', 'false');
    }

    els.fab.addEventListener('click', function () { isOpen ? closePanel() : openPanel(); });
    els.close.addEventListener('click', closePanel);
    els.clear.addEventListener('click', function () {
        history = [];
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
        els.messages.innerHTML = '';
        history.push({ role: 'bot', content: WELCOME });
        renderMessage({ role: 'bot', content: WELCOME }, false);
        saveHistory();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && isOpen) closePanel();
    });

    els.form.addEventListener('submit', function (e) {
        e.preventDefault();
        var text = els.input.value;
        els.input.value = '';
        sendMessage(text);
    });

    if (els.chips) {
        els.chips.addEventListener('click', function (e) {
            var chip = e.target.closest('.chat-chip');
            if (chip && chip.dataset.msg && !busy) {
                sendMessage(chip.dataset.msg);
                if (isOpen) els.input.focus();
            }
        });
    }

    // ── Render persisted history ──
    loadHistory();
    history.forEach(function (m) { renderMessage(m, false); });
})();
