/**
 * NEON SLIDE — NeonBot, the in-game AI companion.
 * Powered by Sarvam AI through a Netlify Function (/api/sarvam-chat)
 * with MCP-style tool calling. The API key stays server-side.
 *
 * Self-contained: injects its own styles + widget markup, then wires it up.
 * Design: floating glowing bubble → tap → glassmorphic chat panel opens
 *         with smooth spring animation, avatars, neon accents.
 */
(function () {
    'use strict';

    var ENDPOINT = '/api/sarvam-chat';
    var STORAGE_KEY = 'neonslide_chat_v1';
    var SESSION_KEY = 'neonslide_session_v1';
    var WELCOME = "Hey! I'm NeonBot — your Neon Slide companion, powered by Sarvam AI. Ask me how to play, get strategy tips, or chat in any language you like!";
    var MAX_STORED = 24;
    var MAX_SENT = 12;

    // ═════════════════════════════════════════════════════════════
    //  STYLES — cyberpunk neon glass theme
    // ═════════════════════════════════════════════════════════════
    var CSS = [
        // ── Floating Action Button (the bubble) ──
        '.chat-fab{position:fixed;right:20px;bottom:20px;width:58px;height:58px;border-radius:50%;',
        'border:none;cursor:pointer;z-index:9998;padding:0;',
        'background:linear-gradient(135deg,#c9a96e,#a88950);',
        'box-shadow:0 4px 20px rgba(201,169,110,.5),0 0 0 0 rgba(201,169,110,.4);',
        'display:flex;align-items:center;justify-content:center;',
        'transition:transform .3s cubic-bezier(.34,1.56,.64,1),box-shadow .3s ease;',
        'animation:chatPulse 2.5s ease-in-out infinite}',
        '@keyframes chatPulse{',
        '0%{box-shadow:0 4px 20px rgba(201,169,110,.5),0 0 0 0 rgba(201,169,110,.4)}',
        '50%{box-shadow:0 4px 20px rgba(201,169,110,.5),0 0 0 14px rgba(201,169,110,0)}',
        '100%{box-shadow:0 4px 20px rgba(201,169,110,.5),0 0 0 0 rgba(201,169,110,0)}}',
        '.chat-fab:hover{transform:scale(1.1) rotate(5deg)}',
        '.chat-fab:active{transform:scale(.92)}',
        '.chat-fab svg{width:28px;height:28px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.3))}',
        '.chat-fab.open{transform:scale(0) rotate(180deg);opacity:0;pointer-events:none}',
        // ── Chat Panel (glassmorphic) ──
        '.chat-panel{position:fixed;right:20px;bottom:90px;width:min(380px,calc(100vw - 40px));',
        'max-height:min(600px,calc(100vh - 130px));display:flex;flex-direction:column;',
        'background:rgba(15,12,25,.88);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);',
        'border:1px solid rgba(201,169,110,.2);border-radius:20px;overflow:hidden;',
        'box-shadow:0 24px 80px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.03) inset;',
        'z-index:9999;opacity:0;transform:translateY(20px) scale(.92);pointer-events:none;',
        'transition:opacity .3s ease,transform .35s cubic-bezier(.34,1.56,.64,1)}',
        '.chat-panel.open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}',
        // ── Header ──
        '.chat-header{display:flex;align-items:center;gap:12px;padding:16px 18px;',
        'background:linear-gradient(135deg,rgba(201,169,110,.08),transparent);',
        'border-bottom:1px solid rgba(201,169,110,.1);position:relative}',
        '.chat-avatar{width:40px;height:40px;border-radius:50%;flex:none;',
        'background:linear-gradient(135deg,rgba(201,169,110,.15),rgba(201,169,110,.05));',
        'border:2px solid rgba(201,169,110,.4);display:flex;align-items:center;justify-content:center;',
        'font-size:1.1rem;color:#e0c890;position:relative}',
        '.chat-avatar::after{content:"";position:absolute;bottom:-1px;right:-1px;',
        'width:12px;height:12px;border-radius:50%;background:#7bb881;',
        'border:2px solid rgba(15,12,25,.88);box-shadow:0 0 6px #7bb881}',
        '.chat-header-info{flex:1;min-width:0}',
        '.chat-header-name{font-size:.9rem;font-weight:600;color:#e0c890;letter-spacing:.3px}',
        '.chat-header-status{font-size:.62rem;color:#8b8497;margin-top:2px;letter-spacing:.8px;text-transform:uppercase}',
        '.chat-header-actions{display:flex;gap:6px}',
        '.chat-header-btn{width:30px;height:30px;border-radius:8px;border:none;cursor:pointer;',
        'background:rgba(255,255,255,.05);color:#8b8497;font-size:.9rem;',
        'display:flex;align-items:center;justify-content:center;transition:all .2s ease}',
        '.chat-header-btn:hover{background:rgba(201,169,110,.15);color:#e0c890}',
        // ── Messages area ──
        '.chat-body{flex:1;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:12px;',
        'scrollbar-width:thin;scrollbar-color:rgba(201,169,110,.3) transparent;',
        'min-height:200px;user-select:text}',
        '.chat-body::-webkit-scrollbar{width:4px}',
        '.chat-body::-webkit-scrollbar-thumb{background:rgba(201,169,110,.2);border-radius:4px}',
        // ── Message rows ──
        '.chat-msg{display:flex;gap:8px;max-width:88%;animation:msgIn .3s ease}',
        '.chat-msg.user{align-self:flex-end;flex-direction:row-reverse}',
        '@keyframes msgIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',
        '.chat-msg-avatar{width:28px;height:28px;border-radius:50%;flex:none;font-size:.8rem;',
        'display:flex;align-items:center;justify-content:center;margin-top:auto}',
        '.chat-msg.bot .chat-msg-avatar{background:rgba(201,169,110,.12);border:1px solid rgba(201,169,110,.25);color:#e0c890}',
        '.chat-msg.user .chat-msg-avatar{display:none}',
        '.chat-msg-content{display:flex;flex-direction:column;gap:3px;min-width:0}',
        '.chat-msg.user .chat-msg-content{align-items:flex-end}',
        '.chat-bubble{padding:10px 14px;border-radius:16px;font-size:.82rem;line-height:1.55;',
        'white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}',
        '.chat-msg.bot .chat-bubble{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);',
        'color:#ece8e0;border-bottom-left-radius:4px}',
        '.chat-msg.user .chat-bubble{background:linear-gradient(135deg,rgba(201,169,110,.18),rgba(201,169,110,.08));',
        'border:1px solid rgba(201,169,110,.2);color:#e0c890;border-bottom-right-radius:4px}',
        '.chat-msg.error .chat-bubble{background:rgba(199,123,123,.1);border-color:rgba(199,123,123,.3);color:#c77b7b}',
        '.chat-msg-meta{font-size:.55rem;color:#5a5468;padding:0 4px;letter-spacing:.4px}',
        // ── Tool badges ──
        '.chat-tools{display:flex;gap:4px;flex-wrap:wrap;padding:4px 4px 0}',
        '.chat-tool-badge{font-size:.52rem;color:#c9a96e;background:rgba(201,169,110,.08);',
        'border:1px solid rgba(201,169,110,.2);padding:2px 7px;border-radius:999px;',
        'letter-spacing:.3px;text-transform:uppercase;font-weight:500}',
        // ── Typing indicator ──
        '.chat-typing{display:flex;gap:8px;align-self:flex-start;max-width:88%}',
        '.chat-typing-avatar{width:28px;height:28px;border-radius:50%;flex:none;',
        'background:rgba(201,169,110,.12);border:1px solid rgba(201,169,110,.25);',
        'display:flex;align-items:center;justify-content:center;font-size:.8rem;color:#e0c890}',
        '.chat-typing-dots{display:flex;gap:4px;align-items:center;padding:12px 16px;',
        'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:16px;border-bottom-left-radius:4px}',
        '.chat-typing-dots span{width:7px;height:7px;border-radius:50%;background:#c9a96e;opacity:.4;',
        'animation:typingBounce 1.4s infinite}',
        '.chat-typing-dots span:nth-child(2){animation-delay:.2s}',
        '.chat-typing-dots span:nth-child(3){animation-delay:.4s}',
        '@keyframes typingBounce{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-6px);opacity:1}}',
        // ── Quick chips ──
        '.chat-chips{display:flex;gap:6px;padding:8px 18px 12px;flex-wrap:wrap}',
        '.chat-chip{padding:7px 12px;border-radius:999px;font-size:.66rem;cursor:pointer;',
        'border:1px solid rgba(201,169,110,.15);background:rgba(255,255,255,.03);color:#8b8497;',
        'transition:all .2s ease;letter-spacing:.2px;white-space:nowrap;font-weight:500}',
        '.chat-chip:hover{background:rgba(201,169,110,.1);color:#e0c890;border-color:rgba(201,169,110,.35)}',
        // ── Input area ──
        '.chat-input-area{display:flex;gap:8px;padding:14px 18px 16px;',
        'border-top:1px solid rgba(201,169,110,.08);background:rgba(0,0,0,.15)}',
        '.chat-input{flex:1;min-width:0;padding:11px 16px;border-radius:14px;',
        'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);',
        'color:#ece8e0;font:inherit;font-size:.82rem;transition:all .2s ease;user-select:text}',
        '.chat-input::placeholder{color:#5a5468}',
        '.chat-input:focus{outline:none;border-color:rgba(201,169,110,.4);background:rgba(255,255,255,.06)}',
        '.chat-send{width:42px;height:42px;border-radius:14px;border:none;cursor:pointer;flex:none;',
        'background:linear-gradient(135deg,#c9a96e,#a88950);color:#1a1408;font-size:1.1rem;',
        'display:flex;align-items:center;justify-content:center;transition:all .2s ease}',
        '.chat-send:hover{transform:scale(1.05);box-shadow:0 4px 16px rgba(201,169,110,.4)}',
        '.chat-send:active{transform:scale(.95)}',
        '.chat-send:disabled{opacity:.4;cursor:not-allowed;transform:none}',
        // ── Mobile ──
        '@media (max-width:480px){',
        '.chat-panel{right:12px;bottom:80px;width:calc(100vw - 24px);max-height:calc(100vh - 110px)}',
        '.chat-fab{right:16px;bottom:16px;width:54px;height:54px}}'
    ].join('');

    function injectStyles() {
        var style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    // ═════════════════════════════════════════════════════════════
    //  WIDGET MARKUP
    // ═════════════════════════════════════════════════════════════
    var CHAT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="#1a1408" stroke-width="2.2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>';

    var CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px">' +
        '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

    var CLEAR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px">' +
        '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';

    var SEND_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
        'stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px">' +
        '<line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';

    var MARKUP =
        '<button class="chat-fab" id="chat-fab" aria-label="Open NeonBot AI chat" aria-expanded="false" title="NeonBot AI">' + CHAT_ICON + '</button>' +
        '<div class="chat-panel" id="chat-panel" role="dialog" aria-label="NeonBot AI chat" aria-hidden="true">' +
            '<div class="chat-header">' +
                '<div class="chat-avatar">\u25C6</div>' +
                '<div class="chat-header-info">' +
                    '<div class="chat-header-name">NeonBot</div>' +
                    '<div class="chat-header-status">Sarvam AI \u00B7 Online</div>' +
                '</div>' +
                '<div class="chat-header-actions">' +
                    '<button type="button" class="chat-header-btn" id="chat-clear" title="Clear chat" aria-label="Clear chat history">' + CLEAR_ICON + '</button>' +
                    '<button type="button" class="chat-header-btn" id="chat-close" title="Close" aria-label="Close chat">' + CLOSE_ICON + '</button>' +
                '</div>' +
            '</div>' +
            '<div class="chat-body" id="chat-messages" aria-live="polite"></div>' +
            '<div class="chat-chips" id="chat-chips">' +
                '<button type="button" class="chat-chip" data-msg="How do I play Neon Slide?">How to play</button>' +
                '<button type="button" class="chat-chip" data-msg="Give me strategy tips for the 4\u00D74 board.">Strategy tips</button>' +
                '<button type="button" class="chat-chip" data-msg="What par moves should I aim for?">Par moves</button>' +
                '<button type="button" class="chat-chip" data-msg="\u092E\u0941\u091D\u0938\u0947 \u0939\u093F\u0902\u0926\u0940 \u092E\u0947\u0902 \u092C\u093E\u0924 \u0915\u0930\u094B">हिंदी में बात</button>' +
            '</div>' +
            '<form class="chat-input-area" id="chat-form">' +
                '<input type="text" class="chat-input" id="chat-input" autocomplete="off" maxlength="1000" placeholder="Ask NeonBot anything\u2026" aria-label="Message NeonBot">' +
                '<button type="submit" class="chat-send" id="chat-send" aria-label="Send message">' + SEND_ICON + '</button>' +
            '</form>' +
        '</div>';

    function injectWidget() {
        var host = document.createElement('div');
        host.innerHTML = MARKUP;
        while (host.firstChild) document.body.appendChild(host.firstChild);
    }

    // ═════════════════════════════════════════════════════════════
    //  BOOT
    // ═════════════════════════════════════════════════════════════
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

    // ═════════════════════════════════════════════════════════════
    //  PERSISTENCE
    // ═════════════════════════════════════════════════════════════
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
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_STORED))); } catch (e) {}
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

    // ═════════════════════════════════════════════════════════════
    //  RENDERING
    // ═════════════════════════════════════════════════════════════
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
        var isUser = msg.role === 'user';
        var isError = msg.role === 'error';
        var wrap = el('div', 'chat-msg ' + (isUser ? 'user' : (isError ? 'bot error' : 'bot')));

        // Avatar for bot messages
        if (!isUser) {
            var avatar = el('div', 'chat-msg-avatar', '\u25C6');
            wrap.appendChild(avatar);
        }

        var content = el('div', 'chat-msg-content');
        var bubble = el('div', 'chat-bubble', msg.content);
        content.appendChild(bubble);
        content.appendChild(el('div', 'chat-msg-meta',
            (isUser ? 'You' : isError ? 'Error' : 'NeonBot') + ' \u00B7 ' + timeLabel()));
        wrap.appendChild(content);

        els.messages.appendChild(wrap);
        els.messages.scrollTop = els.messages.scrollHeight;
    }

    function renderTyping() {
        var wrap = el('div', 'chat-typing');
        wrap.id = 'chat-typing';
        var avatar = el('div', 'chat-typing-avatar', '\u25C6');
        var dots = el('div', 'chat-typing-dots');
        dots.appendChild(el('span'));
        dots.appendChild(el('span'));
        dots.appendChild(el('span'));
        wrap.appendChild(avatar);
        wrap.appendChild(dots);
        els.messages.appendChild(wrap);
        els.messages.scrollTop = els.messages.scrollHeight;
    }

    function removeTyping() {
        var t = document.getElementById('chat-typing');
        if (t) t.remove();
    }

    // ═════════════════════════════════════════════════════════════
    //  LIVE GAME CONTEXT (sent with every message)
    // ═════════════════════════════════════════════════════════════
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
                    ctx.tiles = state.tiles.slice(0, 100).map(function (v) {
                        var n = parseInt(v, 10);
                        return (typeof n === 'number' && isFinite(n) && n >= 0) ? n : 0;
                    });
                }
            }
        } catch (e) {}
        try {
            if (typeof scoringUser !== 'undefined' && typeof scoringUser === 'string' && scoringUser) {
                ctx.player = scoringUser.slice(0, 24);
            }
        } catch (e) {}
        return ctx;
    }

    // ═════════════════════════════════════════════════════════════
    //  API CALL
    // ═════════════════════════════════════════════════════════════
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
                    // Tool badges
                    if (r.data.tools_used && r.data.tools_used.length) {
                        var lastMsg = els.messages.lastElementChild;
                        if (lastMsg) {
                            var contentDiv = lastMsg.querySelector('.chat-msg-content');
                            if (contentDiv) {
                                var tools = el('div', 'chat-tools');
                                r.data.tools_used.forEach(function(t) {
                                    var badge = el('span', 'chat-tool-badge');
                                    badge.textContent = '\u26A1 ' + t.label;
                                    tools.appendChild(badge);
                                });
                                contentDiv.appendChild(tools);
                            }
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

    // ═════════════════════════════════════════════════════════════
    //  PANEL CONTROLS
    // ═════════════════════════════════════════════════════════════
    function openPanel() {
        isOpen = true;
        els.panel.classList.add('open');
        els.fab.classList.add('open');
        els.panel.setAttribute('aria-hidden', 'false');
        els.fab.setAttribute('aria-expanded', 'true');
        if (!els.messages.childNodes.length) {
            history.push({ role: 'bot', content: WELCOME });
            renderMessage({ role: 'bot', content: WELCOME }, false);
            saveHistory();
        }
        setTimeout(function () { els.input.focus(); }, 350);
    }

    function closePanel() {
        isOpen = false;
        els.panel.classList.remove('open');
        els.fab.classList.remove('open');
        els.panel.setAttribute('aria-hidden', 'true');
        els.fab.setAttribute('aria-expanded', 'false');
    }

    // ═════════════════════════════════════════════════════════════
    //  EVENT LISTENERS
    // ═════════════════════════════════════════════════════════════
    els.fab.addEventListener('click', function () { isOpen ? closePanel() : openPanel(); });
    els.close.addEventListener('click', closePanel);
    els.clear.addEventListener('click', function () {
        history = [];
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
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

    // ═════════════════════════════════════════════════════════════
    //  INIT — render persisted history
    // ═════════════════════════════════════════════════════════════
    loadHistory();
    history.forEach(function (m) { renderMessage(m, false); });
})();
