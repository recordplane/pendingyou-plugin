// Generated from packages/claude-plugin/src/wake/register.ts in recordplane/pendingyou: edit that, then run
// `pnpm --filter @pendingyou/claude-plugin generate`.

import { argumentsOf, blockedNote, CLAIM_PREFIX, CLI_COPY, cardTool, checked, claimLease, connectionOf, dueCards, emptyBook, failed, folderOf, HANDED_FAST_MS, HANDED_READS, handedDue, handedNext, handedOf, handedText, handedView, holdOf, holdReply, isRefusal, isStale, isWaitingOnYou, KEEP_MS, learn, leaseHolder, momentOf, prompted, put, readBook, readClaim, readSetup, resultObject, SETUP_AFTER_MS, SETUP_RETRY_MS, SETUP_SERVER, SETUP_TRIES, settle, setUpOf, setupNeeded, setupPrompt, stateOf, statusText, TICK_MS, takesHanded, told, toTell, untold, wakeText, } from "./wake.js";
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
    seenAt: 0,
    handedAt: 0,
    handedTold: new Map(),
    folders: [],
    home: undefined,
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
async function allowed($, server, args, tool = 'get_request') {
    try {
        const decided = await $.tool.check({ tool: `mcp__${server}__${tool}`, input: args });
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
        return false;
    const cards = toTell(live.book);
    if (cards.length === 0 || (await $.clock.now()) < live.quietUntil)
        return false;
    if (!(await claim($)))
        return false;
    live.book = told(live.book, cards);
    await save($);
    $.prompt.submit({ text: wakeText(cards) }).catch(async () => {
        live.book = untold(live.book, cards);
        live.quietUntil = (await $.clock.now()) + RETRY_MS;
        await save($).catch(() => { });
    });
    return true;
}
async function deliverHanded($) {
    const { name, server } = live.book;
    const now = await $.clock.now();
    if (live.busy || !name || !server || !handedDue(live.seenAt, live.handedAt, now))
        return;
    live.handedAt = handedNext(live.seenAt, now);
    if (!(await allowed($, server, { name }, 'list_pending')))
        return;
    let listed;
    try {
        listed = handedOf(resultObject(await $.mcp.call(server, 'list_pending', { name })));
    }
    catch {
        return;
    }
    const cards = [];
    const claims = [];
    for (const handed of listed) {
        const known = live.handedTold.get(handed.requestId);
        if (known === '*' || known === handed.updatedAt)
            continue;
        if (!takesHanded(handed, live.folders, live.home, now))
            continue;
        const key = `${CLAIM_PREFIX}${handed.requestId}`;
        if (readClaim(await $.store.get(key))?.moment === handed.updatedAt) {
            live.handedTold.set(handed.requestId, handed.updatedAt);
            continue;
        }
        const args = { requestId: handed.requestId, name };
        if (!(await allowed($, server, args)))
            continue;
        let view = null;
        try {
            view = handedView(resultObject(await $.mcp.call(server, 'get_request', args)), handed, name);
        }
        catch { }
        if (!view)
            continue;
        await $.store.set(key, { moment: handed.updatedAt, at: now });
        live.handedTold.set(handed.requestId, handed.updatedAt);
        claims.push(key);
        cards.push(view);
    }
    if (cards.length === 0)
        return;
    $.prompt.submit({ text: handedText(cards) }).catch(async () => {
        for (const key of claims)
            await $.store.delete(key).catch(() => { });
        for (const card of cards)
            live.handedTold.delete(card.requestId);
        live.handedAt = (await $.clock.now()) + RETRY_MS;
    });
}
async function prune($) {
    const now = await $.clock.now();
    for (const key of await $.store.keys()) {
        if (key.startsWith(CLAIM_PREFIX)) {
            if (now - (readClaim(await $.store.get(key))?.at ?? 0) > KEEP_MS)
                await $.store.delete(key);
            continue;
        }
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
        if (!(await deliver($)))
            await deliverHanded($);
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
function freshHanded() {
    live.seenAt = Object.keys(live.book.cards).length ? live.book.updatedAt : 0;
    live.handedAt = 0;
    live.handedTold = new Map();
}
async function folderOfSession($, cwd) {
    live.folders = typeof cwd === 'string' && cwd ? [cwd] : [];
    try {
        live.home = (await $.env.get('HOME')) || undefined;
    }
    catch {
        live.home = undefined;
    }
}
async function start($, e) {
    live.me = $.plugin.name;
    live.sessionId = await $.session.id();
    live.book = readBook(await $.store.get(keyOf(live.sessionId)));
    freshHanded();
    await folderOfSession($, e.cwd);
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
    freshHanded();
    if (typeof e.cwd === 'string' && e.cwd)
        await folderOfSession($, e.cwd);
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
    const now = await $.clock.now();
    if (output) {
        live.seenAt = now;
        live.handedAt = Math.min(live.handedAt, now + HANDED_FAST_MS);
    }
    const read = e.requestId ?? output?.requestId;
    if (HANDED_READS.has(found.tool) && typeof read === 'string')
        live.handedTold.set(read, '*');
    const folder = output ? folderOf(found.tool, argumentsOf(e)) : undefined;
    if (folder && !live.folders.includes(folder))
        live.folders = [...live.folders, folder].slice(-5);
    const before = live.book;
    live.book = learn(live.book, { ...found, input: argumentsOf(e), output }, now);
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
        tool: /^mcp__.+__(post_request|get_request|update_request|reply_in_thread|ack_answer|cancel_request|whoami|list_pending|answer_delegated|hand_back)$/,
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
