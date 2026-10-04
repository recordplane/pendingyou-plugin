// Generated from packages/claude-plugin/src/wake/register.ts in recordplane/pendingyou: edit that, then run
// `pnpm --filter @pendingyou/claude-plugin generate`.

// The Pending You wake mod's hooks module, for Claude Code 2.1.287 and later: the thin part that calls Claude Code.
// What the mod does, and every rule it follows, is in wake.ts; src/plugin.ts ships both as JavaScript.
//
// It never gets in the way. Every hook passes its event on; a failure in the mod's own work is swallowed; and a hold it
// can't stand behind (another copy of the mod acts for this session, or Claude Code won't let it check the card) runs
// as it is. Its checks are get_request calls over the session's own connection, so they need what the agent's own
// calls need: Pending You's tools allowed (`npx pendingyou init` allows mcp__pendingyou; the plugin's setup asks the
// person to allow its server). It asks Claude Code first ($.tool.check, a question that runs nothing): a check that
// isn't allowed would open a permission dialog in an interactive session and hold up the call it runs in (seen
// 2026-10-04). Until it's allowed, the mod says so, under the prompt and once to the agent.
//
// One copy acts per session: the plugin's and the command line's copy can both load, and they keep separate stores, so
// the lease is a variable in the session's own environment, which every mod in the process shares.
import { argumentsOf, blockedNote, cardTool, checked, claimLease, dueCards, emptyBook, failed, holdOf, holdReply, isRefusal, isStale, isWaitingOnYou, learn, leaseHolder, momentOf, put, readBook, resultObject, settle, stateOf, statusText, TICK_MS, told, toTell, untold, wakeText, } from "./wake.js";
/** After a prompt that didn't go, how long before the mod tries again. */
const RETRY_MS = 60_000;
/** What the mod holds while its module is loaded. The cards themselves are kept in the store. */
const live = {
    /** This copy's name in the lease: its plugin's. */
    me: '',
    sessionId: '',
    book: emptyBook(),
    owner: false,
    /** A turn of the main conversation is running: a prompt now would only queue behind it. */
    busy: false,
    ticking: false,
    pruned: false,
    quietUntil: 0,
    timer: null,
    shown: undefined,
    /** Servers Claude Code refused a check on. */
    blocked: new Set(),
    /** Servers a check worked on this session. */
    verified: new Set(),
    /** Servers the agent was told it can't be woken through. */
    noted: new Set(),
};
const keyOf = (sessionId) => `session:${sessionId}`;
/** A server Claude Code refuses checks on, while the session has a card there. */
function blockedServer() {
    for (const server of live.blocked)
        if (Object.values(live.book.cards).some((card) => card.server === server))
            return server;
    return undefined;
}
/** Keeps the session's cards in the store; a session with none left keeps nothing there. */
async function save($) {
    live.book = { ...live.book, updatedAt: await $.clock.now() };
    if (Object.keys(live.book.cards).length)
        await $.store.set(keyOf(live.sessionId), live.book);
    else
        await $.store.delete(keyOf(live.sessionId));
}
/** Takes or renews the lease; true while this copy holds it. */
async function claim($) {
    const now = await $.clock.now();
    const value = claimLease(await $.env.get('PENDINGYOU_WAKE_OWNER'), live.me, now);
    if (value)
        await $.env.set('PENDINGYOU_WAKE_OWNER', value);
    live.owner = leaseHolder(await $.env.get('PENDINGYOU_WAKE_OWNER'), now) === live.me;
    return live.owner;
}
function show($, text) {
    if (text === live.shown)
        return;
    live.shown = text;
    try {
        const shown = $.ui.status(text);
        if (shown instanceof Promise)
            shown.catch(() => { });
    }
    catch { }
}
const showCards = ($) => show($, live.owner ? statusText(live.book, blockedServer()) : undefined);
/** Whether Claude Code lets the mod make this call now, without asking anyone: never opens a dialog. */
async function allowed($, server, args) {
    try {
        const decided = await $.tool.check({ tool: `mcp__${server}__get_request`, input: args });
        return decided.decision === 'allow';
    }
    catch {
        return false;
    }
}
/** Checks one card now through the session's connection: ok, blocked (Claude Code won't allow it), or error. */
async function check($, requestId) {
    const card = live.book.cards[requestId];
    if (!card)
        return 'error';
    let output = null;
    let blocked = false;
    const args = { requestId, ...(card.name ? { name: card.name } : {}) };
    if (await allowed($, card.server, args)) {
        try {
            output = resultObject(await $.mcp.call(card.server, 'get_request', args));
        }
        catch (error) {
            blocked = isRefusal(error);
        }
    }
    else
        blocked = true;
    const outcome = output && stateOf(output) ? 'ok' : blocked ? 'blocked' : 'error';
    if (outcome === 'ok') {
        live.verified.add(card.server);
        live.blocked.delete(card.server);
    }
    else if (outcome === 'blocked')
        live.blocked.add(card.server);
    // The card as it is now: the agent may have acked or changed it while the check ran.
    const current = live.book.cards[requestId];
    if (!current)
        return outcome;
    const now = await $.clock.now();
    const next = output && outcome === 'ok' ? checked(current, output, now) : failed(current, now, blocked);
    live.book = put(live.book, next);
    if (!current.state || (next.state && momentOf(current.state) !== momentOf(next.state)))
        await save($);
    return outcome;
}
/** Starts one turn for every card whose moment the agent hasn't heard, while the session is idle. */
async function deliver($) {
    if (live.busy)
        return;
    const cards = toTell(live.book);
    if (cards.length === 0 || (await $.clock.now()) < live.quietUntil)
        return;
    if (!(await claim($)))
        return;
    live.book = told(live.book, cards);
    await save($);
    $.prompt.submit({ text: wakeText(cards) }).catch(async () => {
        live.book = untold(live.book, cards);
        live.quietUntil = (await $.clock.now()) + RETRY_MS;
        await save($).catch(() => { });
    });
}
/** Forgets other sessions' lists that nobody has touched for 7 days. */
async function prune($) {
    const now = await $.clock.now();
    for (const key of await $.store.keys()) {
        if (!key.startsWith('session:') || key === keyOf(live.sessionId))
            continue;
        if (isStale(readBook(await $.store.get(key)), now))
            await $.store.delete(key);
    }
}
async function tick($) {
    if (live.ticking || !live.sessionId)
        return;
    live.ticking = true;
    try {
        if (!live.pruned) {
            live.pruned = true;
            await prune($);
        }
        if (!(await claim($))) {
            show($, undefined);
            return;
        }
        const now = await $.clock.now();
        const settled = settle(live.book, now);
        if (settled !== live.book) {
            live.book = settled;
            await save($);
        }
        for (const card of dueCards(live.book, now))
            await check($, card.requestId);
        await deliver($);
        showCards($);
    }
    catch {
        // The next tick tries again.
    }
    finally {
        live.ticking = false;
    }
}
function soon($) {
    try {
        $.clock.after(1500, () => tick($));
    }
    catch { }
}
async function start($) {
    live.me = $.plugin.name;
    live.sessionId = await $.session.id();
    live.book = readBook(await $.store.get(keyOf(live.sessionId)));
    await claim($);
    live.timer?.cancel();
    live.timer = $.clock.every(TICK_MS, () => tick($));
    soon($);
}
/** After /clear, /resume or /branch: the session's id changed, and its cards with it (a branch keeps them). */
async function switchSession($, e) {
    const id = typeof e.session_id === 'string' && e.session_id ? e.session_id : await $.session.id();
    if (!id || id === live.sessionId)
        return;
    const carried = e.source === 'fork' ? live.book : null;
    live.sessionId = id;
    live.book = carried ?? readBook(await $.store.get(keyOf(id)));
    live.noted.clear();
    if (carried)
        await save($);
    showCards($);
}
/** Learns from one of the session's own Pending You calls, and says once when Claude Code won't let it check. */
async function observe($, e, result) {
    const found = cardTool(e.tool);
    if (!found || !live.sessionId)
        return result;
    const output = resultObject(result);
    const before = live.book;
    live.book = learn(live.book, { ...found, input: argumentsOf(e), output }, await $.clock.now());
    if (live.book === before)
        return result;
    await save($);
    const id = output?.requestId ?? e.requestId;
    const card = typeof id === 'string' ? live.book.cards[id] : undefined;
    // A card just put in front of the person, on a server not checked yet this session: check it now, so a refusal is
    // known while the agent can still tell its person.
    if (live.owner && card?.state && isWaitingOnYou(card.state) && !live.verified.has(card.server)) {
        const outcome = await check($, card.requestId);
        if (outcome === 'blocked' && !live.noted.has(card.server)) {
            live.noted.add(card.server);
            showCards($);
            return { ...result, context: [...(result.context ?? []), blockedNote(card.server)] };
        }
    }
    showCards($);
    return result;
}
/**
 * Answers `npx pendingyou hold <id>` for this session: nothing runs, and the mod wakes it instead. Null when the hold
 * should run as it is: another copy acts here (it answers), the card's server isn't known, or a check didn't work.
 */
async function answerHold($, e) {
    const requestId = typeof e.command === 'string' ? holdOf(e.command) : null;
    if (!requestId || !live.sessionId)
        return null;
    const known = live.book.cards[requestId];
    const server = known?.server ?? live.book.server;
    if (!server)
        return null;
    if (!known) {
        const now = await $.clock.now();
        const name = live.book.name;
        live.book = put(live.book, {
            requestId,
            server,
            ...(name ? { name } : {}),
            learnedAt: now,
            changedAt: now,
            nextAt: now,
        });
        await save($);
    }
    if (!(await claim($)))
        return null;
    if ((await check($, requestId)) !== 'ok')
        return null;
    showCards($);
    return { result: { stdout: holdReply(requestId), stderr: '', interrupted: false } };
}
export function register(on) {
    on('session.start', async ($, e, next) => {
        try {
            await start($);
        }
        catch { }
        return next(e);
    });
    on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
        try {
            await switchSession($, e);
        }
        catch { }
        return next(e);
    });
    on('turn.start', async (_, e, next) => {
        if (!e.agentId)
            live.busy = true;
        return next(e);
    });
    on('turn.complete', async ($, e, next) => {
        if (!e.agentId) {
            live.busy = false;
            soon($);
        }
        return next(e);
    });
    on('tool.call', {
        tool: /^mcp__.+__(post_request|get_request|update_request|reply_in_thread|ack_answer|cancel_request|whoami|list_pending)$/,
    }, async ($, e, next) => {
        const result = await next(e);
        try {
            return await observe($, e, result);
        }
        catch {
            return result;
        }
    });
    on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
        let answer = null;
        try {
            answer = await answerHold($, e);
        }
        catch { }
        return answer ?? next(e);
    });
}
