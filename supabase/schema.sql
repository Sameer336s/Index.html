-- ═══════════════════════════════════════════════════════════════════════
-- NEON SLIDE — Supabase setup (run this ONCE in the Supabase SQL Editor)
-- ═══════════════════════════════════════════════════════════════════════
-- This creates everything the site's Netlify Functions expect:
--   auth.js    → neonslide_signup, neonslide_login,
--                neonslide_recover_by_email, neonslide_reset_password
--   scores.js  → neonslide_create_game, neonslide_get_game,
--                neonslide_get_game_time, neonslide_finish_game,
--                neonslide_get_leaderboard, neonslide_get_best
--
-- The chatbot (sarvam-chat) does NOT need any of this — it runs entirely
-- on the Netlify Function with the Sarvam AI key.
--
-- HOW TO USE:
--   1. Open https://supabase.com/dashboard → your project → SQL Editor
--   2. Paste this whole file → Run
--   3. In Netlify: Site configuration → Environment variables, add:
--        SUPABASE_URL       = https://<your-project-ref>.supabase.co
--        SUPABASE_ANON_KEY  = <your project's anon/publishable key>
--        JWT_SECRET         = <any long random string, e.g. 64 hex chars>
--        SARVAM_API_KEY     = <your Sarvam AI key (sk_...)>
--      then Deploy → Trigger deploy so the functions pick them up.
-- ═══════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Tables ──────────────────────────────────────────────────────────────

create table if not exists public.neonslide_users (
    id             uuid primary key default gen_random_uuid(),
    username       text not null unique,
    email          text not null unique,
    password_hash  text not null,
    email_confirmed boolean not null default true,
    created_at     timestamptz not null default now()
);

create table if not exists public.neonslide_reset_tokens (
    token      text primary key,
    user_id    uuid not null references public.neonslide_users(id) on delete cascade,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);

create table if not exists public.neonslide_games (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references public.neonslide_users(id) on delete cascade,
    size         int  not null check (size in (3, 4, 5, 6, 10)),
    board        jsonb not null,
    started_at   timestamptz not null default now(),
    completed_at timestamptz
);

create table if not exists public.neonslide_scores (
    game_id    uuid primary key references public.neonslide_games(id) on delete cascade,
    user_id    uuid not null references public.neonslide_users(id) on delete cascade,
    size       int  not null,
    moves      int  not null check (moves >= 0),
    elapsed_ms bigint not null check (elapsed_ms >= 0),
    created_at timestamptz not null default now()
);

create index if not exists neonslide_scores_board_idx on public.neonslide_scores (size, moves asc, elapsed_ms asc);
create index if not exists neonslide_scores_user_idx  on public.neonslide_scores (user_id, size);

-- Lock tables down: everything is reachable only through the RPC functions below.
alter table public.neonslide_users        enable row level security;
alter table public.neonslide_reset_tokens enable row level security;
alter table public.neonslide_games        enable row level security;
alter table public.neonslide_scores       enable row level security;

-- ── Auth RPCs ───────────────────────────────────────────────────────────

create or replace function public.neonslide_signup(p_username text, p_email text, p_password text)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid;
begin
    if p_username is null or length(p_username) < 3 or length(p_username) > 24
       or p_username !~ '^[A-Za-z0-9_]{3,24}$' then
        raise exception 'invalid_username';
    end if;
    if p_email is null or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
        raise exception 'invalid_email';
    end if;
    if p_password is null or length(p_password) < 12 then
        raise exception 'weak_password';
    end if;

    begin
        insert into public.neonslide_users (username, email, password_hash)
        values (lower(p_username), lower(p_email), crypt(p_password, gen_salt('bf')))
        returning id into v_id;
    exception when unique_violation then
        return null;  -- username or email already exists
    end;
    return v_id;
end;
$$;

create or replace function public.neonslide_login(p_username text, p_password text)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid;
begin
    select id into v_id
    from public.neonslide_users
    where lower(username) = lower(p_username)
      and password_hash = crypt(p_password, password_hash)
    limit 1;
    return v_id;  -- null = invalid credentials
end;
$$;

create or replace function public.neonslide_recover_by_email(p_email text)
returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare v_user uuid; v_token text;
begin
    select id into v_user from public.neonslide_users where lower(email) = lower(p_email) limit 1;
    if v_user is null then
        return null;  -- do not reveal whether the email exists
    end if;
    v_token := encode(gen_random_bytes(24), 'hex');
    delete from public.neonslide_reset_tokens where user_id = v_user;
    insert into public.neonslide_reset_tokens (token, user_id, expires_at)
    values (v_token, v_user, now() + interval '1 hour');
    return v_token;
end;
$$;

create or replace function public.neonslide_reset_password(p_token text, p_new_password text)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_user uuid;
begin
    if p_new_password is null or length(p_new_password) < 12 then
        return false;
    end if;
    select user_id into v_user
    from public.neonslide_reset_tokens
    where token = p_token and expires_at > now()
    limit 1;
    if v_user is null then
        return false;  -- invalid or expired token
    end if;
    update public.neonslide_users
       set password_hash = crypt(p_new_password, gen_salt('bf'))
     where id = v_user;
    delete from public.neonslide_reset_tokens where user_id = v_user;
    return true;
end;
$$;

-- ── Game / score RPCs ───────────────────────────────────────────────────

create or replace function public.neonslide_create_game(p_user_id uuid, p_size int, p_board jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
    if p_size not in (3, 4, 5, 6, 10) then return null; end if;
    insert into public.neonslide_games (user_id, size, board)
    values (p_user_id, p_size, p_board)
    returning id into v_id;
    return v_id;
end;
$$;

create or replace function public.neonslide_get_game(p_game_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $
declare v_board jsonb; v_size int; v_completed timestamptz;
begin
    select board, size, completed_at into v_board, v_size, v_completed
    from public.neonslide_games
    where id = p_game_id
    limit 1;
    if v_board is null then return null; end if;
    if v_completed is not null then
        return jsonb_build_object('completed', true);
    end if;
    return jsonb_build_object('board', v_board, 'size', v_size, 'completed', false);
end;
$;

create or replace function public.neonslide_get_game_time(p_game_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_ms bigint;
begin
    select (extract(epoch from (now() - started_at)) * 1000)::bigint into v_ms
    from public.neonslide_games
    where id = p_game_id
    limit 1;
    if v_ms is null then return null; end if;
    return jsonb_build_object('elapsed_ms', v_ms);
end;
$$;

create or replace function public.neonslide_finish_game(
    p_game_id uuid, p_user_id uuid, p_moves int, p_elapsed_ms bigint
)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_game record;
begin
    select * into v_game
    from public.neonslide_games
    where id = p_game_id and user_id = p_user_id
    limit 1;
    if v_game is null then return false; end if;
    -- Idempotent retry: a completed game with an existing score is already saved.
    if v_game.completed_at is not null then
        return exists (
            select 1 from public.neonslide_scores
            where game_id = p_game_id and user_id = p_user_id
        );
    end if;
    if p_moves is null or p_moves < 1 or p_moves > 100000 then return false; end if;
    if p_elapsed_ms is null or p_elapsed_ms < 0 or p_elapsed_ms > 86400000 then return false; end if;

    insert into public.neonslide_scores (game_id, user_id, size, moves, elapsed_ms)
    values (p_game_id, p_user_id, v_game.size, p_moves, p_elapsed_ms);
    update public.neonslide_games
       set completed_at = now()
     where id = p_game_id;
    return true;
end;
$$;

-- Best completed score per player per size (ties by fastest time).
create or replace function public.neonslide_get_leaderboard(p_size int)
returns table (username text, moves int, elapsed_ms bigint)
language sql security definer set search_path = public
as $$
    select u.username,
           s.moves,
           s.elapsed_ms
    from (
        select distinct on (user_id) user_id, moves, elapsed_ms
        from public.neonslide_scores
        where size = p_size
        order by user_id, moves asc, elapsed_ms asc
    ) s
    join public.neonslide_users u on u.id = s.user_id
    order by s.moves asc, s.elapsed_ms asc
    limit 10;
$$;

create or replace function public.neonslide_get_best(p_user_id uuid, p_size int)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_moves int;
begin
    select min(moves) into v_moves
    from public.neonslide_scores
    where user_id = p_user_id and size = p_size;
    return jsonb_build_object('moves', v_moves);
end;
$$;

-- Grant the anon role access to the RPCs (the site calls them with the
-- publishable anon key through PostgREST — same as the current functions).
grant execute on function
    public.neonslide_signup(text, text, text),
    public.neonslide_login(text, text),
    public.neonslide_recover_by_email(text),
    public.neonslide_reset_password(text, text),
    public.neonslide_create_game(uuid, int, jsonb),
    public.neonslide_get_game(uuid),
    public.neonslide_get_game_time(uuid),
    public.neonslide_finish_game(uuid, uuid, int, bigint),
    public.neonslide_get_leaderboard(int),
    public.neonslide_get_best(uuid, int)
to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- DONE. Reminder for Netlify → Site configuration → Environment variables:
--   SUPABASE_URL, SUPABASE_ANON_KEY, JWT_SECRET, SARVAM_API_KEY
-- then trigger a new deploy.
-- ═══════════════════════════════════════════════════════════════════════
