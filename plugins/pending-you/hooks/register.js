// Generated from packages/claude-plugin/src/wake/register.ts in recordplane/pendingyou: edit that, then run
// `pnpm --filter @pendingyou/claude-plugin generate`.

import { argumentsOf, blockedNote, CLI_COPY, cardTool, checked, claimLease, connectionOf, dueCards, emptyBook, failed, holdOf, holdReply, isRefusal, isStale, isWaitingOnYou, learn, leaseHolder, momentOf, prompted, put, readBook, readSetup, resultObject, SETUP_AFTER_MS, SETUP_RETRY_MS, SETUP_SERVER, SETUP_TRIES, settle, setUpOf, setupNeeded, setupPrompt, stateOf, statusText, TICK_MS, told, toTell, untold, wakeText, } from "./wake.js";
const RETRY_MS = 60_000;
const live = {
    me: '',
    sessionId: '',
    book: emptyBook(),
    owner: false,
    busy: false,
    ticking: false,
    pruned: false,
    quietUntil: 0,
    timer: null,
    shown: undefined,
    blocked: new Set(),
    verified: new Set(),
    noted: new Set(),
    setupDue: false,
    setupConnection: 'Claude Code',
};
const keyOf = (sessionId) => `session:${sessionId}`;
function blockedServer() {
    for (const server of live.blocked)
        if (Object.values(live.book.cards).some((card) => card.server === server))
            return server;
    return undefined;
}
async function save($) {
    live.book = { ...live.book, updatedAt: await $.clock.now() };
    if (Object.keys(live.book.cards).length)
        await $.store.set(keyOf(live.sessionId), live.book);
    else
        await $.store.delete(keyOf(live.sessionId));
}
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
async function allowed($, server, args) {
    try {
        const decided = await $.tool.check({ tool: `mcp__${server}__get_request`, input: args });
        return decided.decision === 'allow';
    }
    catch {
        return false;
    }
}
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
async function prune($) {
    const now = await $.clock.now();
    for (const key of await $.store.keys()) {
        if (!key.startsWith('session:') || key === keyOf(live.sessionId))
            continue;
        if (isStale(readBook(await $.store.get(key)), now))
            await $.store.delete(key);
    }
}
async function setupDone($) {
    const record = readSetup(await $.store.get('setup'));
    if (!record.done)
        await $.store.set('setup', { ...record, done: true });
    live.setupDue = false;
}
async function deliverSetup($) {
    if (!live.setupDue || live.busy)
        return;
    live.setupDue = false;
    const now = await $.clock.now();
    const record = readSetup(await $.store.get('setup'));
    if (!setupNeeded(record, live.sessionId, now))
        return;
    await $.store.set('setup', prompted(record, live.sessionId, now));
    $.prompt.submit({ text: setupPrompt(live.setupConnection) }).catch(() => { });
}
async function checkSetup($, attempt) {
    try {
        if (!setupNeeded(readSetup(await $.store.get('setup')), live.sessionId, await $.clock.now()))
            return;
        const decided = await $.tool.check({ tool: `mcp__${SETUP_SERVER}__whoami`, input: {} });
        if (decided.decision !== 'allow')
            return;
        let setUp = null;
        try {
            const output = resultObject(await $.mcp.call(SETUP_SERVER, 'whoami', {}));
            setUp = setUpOf(output);
            live.setupConnection = connectionOf(output);
        }
        catch { }
        if (setUp === null) {
            if (attempt < SETUP_TRIES)
                $.clock.after(SETUP_RETRY_MS, () => checkSetup($, attempt + 1));
            return;
        }
        if (setUp)
            await setupDone($);
        else {
            live.setupDue = true;
            await deliverSetup($);
        }
    }
    catch { }
}
async function tick($) {
    if (live.ticking || !live.sessionId)
        return;
    live.ticking = true;
    try {
        await deliverSetup($);
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
async function start($, e) {
    live.me = $.plugin.name;
    live.sessionId = await $.session.id();
    live.book = readBook(await $.store.get(keyOf(live.sessionId)));
    await claim($);
    live.timer?.cancel();
    live.timer = $.clock.every(TICK_MS, () => tick($));
    soon($);
    if ($.plugin.name === CLI_COPY && e.isInteractive !== false)
        $.clock.after(SETUP_AFTER_MS, () => checkSetup($, 1));
}
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
async function observe($, e, result) {
    const found = cardTool(e.tool);
    if (!found || !live.sessionId)
        return result;
    const output = resultObject(result);
    if ($.plugin.name === CLI_COPY && found.tool === 'whoami' && setUpOf(output) === true)
        await setupDone($);
    const before = live.book;
    live.book = learn(live.book, { ...found, input: argumentsOf(e), output }, await $.clock.now());
    if (live.book === before)
        return result;
    await save($);
    const id = output?.requestId ?? e.requestId;
    const card = typeof id === 'string' ? live.book.cards[id] : undefined;
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
            await start($, e);
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
