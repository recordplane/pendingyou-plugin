// Generated from packages/claude-plugin/src/wake/wake.ts in recordplane/pendingyou: edit that, then run
// `pnpm --filter @pendingyou/claude-plugin generate`.

// The Pending You wake mod's rules, as plain functions with no Claude Code in them, so every rule has a test
// (test/wake.test.ts). register.ts calls Claude Code and keeps its state; src/plugin.ts ships both as JavaScript in the
// plugin's hooks/ and in the pendingyou command line's mod/.
//
// In one Claude Code session (2.1.287 and later) the mod:
// - learns the session's own cards from its Pending You tool calls: post_request's requestId, update_request,
//   reply_in_thread with reopen (or any reply that leaves the card the person's turn), and get_request of a card still
//   waiting on them; it forgets a card after its ack_answer or cancel_request, or once it's closed;
// - answers `npx pendingyou hold <id>` itself, so nothing runs in the background and nothing has to be restarted;
// - checks each card with get_request over the session's own connection, every 20 seconds while it changed in the
//   last 30 minutes, then every minute, backing off on errors;
// - starts one turn when it's the agent's move (an answer, a message, a fallback that ran, a card closed under it),
//   once per change, several cards in one prompt;
// - shows "N waiting on you" under the prompt (Claude Code puts the plugin's name in front: "⚠ pending-you: 1 waiting
//   on you").
/** How often register.ts looks at what's due. */
export const TICK_MS = 5000;
/** Each card is checked every 20 seconds while it changed in the last 30 minutes, then every minute. */
export const FAST_MS = 20_000;
export const SLOW_MS = 60_000;
export const RECENT_MS = 30 * 60_000;
/** A check that failed is tried again after 20 seconds, doubling each time, up to 15 minutes. */
export const MAX_BACKOFF_MS = 15 * 60_000;
/** The soonest it looks again on Pending You's hint (pollAfterSeconds). */
export const HINT_FLOOR_MS = 5000;
/** While Claude Code won't let the mod check (the tool isn't allowed), it tries again every minute. */
export const BLOCKED_MS = 60_000;
/** A card, or a session's whole list, untouched for 7 days is forgotten. */
export const KEEP_MS = 7 * 24 * 60 * 60_000;
/** The most cards one session keeps; the oldest go first. */
export const MAX_CARDS = 50;
/** The lease that keeps one copy of the mod acting in a session's process, and how often its holder renews it. */
export const LEASE_MS = 60_000;
export const RENEW_MS = 20_000;
/** The most of a card's title a prompt or the status line repeats. */
export const TITLE_CHARS = 80;
const REQUEST_ID = /^req_[A-Za-z0-9-]{1,40}$/;
const OPEN = new Set(['pending', 'snoozed', 'delegated']);
const CLOSED = new Set(['resolved', 'cancelled', 'expired']);
/** The tools the mod reads: the card tools, and two more that say which name and server the session uses. */
const READS = new Set([
    'post_request',
    'get_request',
    'update_request',
    'reply_in_thread',
    'ack_answer',
    'cancel_request',
    'whoami',
    'list_pending',
]);
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const parseJson = (text) => {
    try {
        return JSON.parse(text);
    }
    catch {
        return undefined;
    }
};
const text = (value, max = 200) => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : undefined;
const count = (value) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const requestIdOf = (value) => typeof value === 'string' && REQUEST_ID.test(value) ? value : undefined;
/** A title cut to TITLE_CHARS on one line, with its double quotes made single. */
export function clip(title) {
    const flat = title.replace(/\s+/g, ' ').trim().replaceAll('“', '‘').replaceAll('”', '’');
    const chars = [...flat];
    return chars.length <= TITLE_CHARS
        ? flat
        : `${chars
            .slice(0, TITLE_CHARS - 1)
            .join('')
            .trimEnd()}…`;
}
/** Whether an MCP server is a Pending You, whatever it's called (`pendingyou`, the plugin's, a claude.ai connector). */
export const isPendingYou = (server) => server
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .includes('pendingyou');
/** `mcp__<server>__<tool>` for a Pending You tool the mod reads; null for any other tool. */
export function cardTool(name) {
    const match = /^mcp__(.+)__([a-z_]+)$/.exec(name);
    if (!match)
        return null;
    const [, server = '', tool = ''] = match;
    return READS.has(tool) && isPendingYou(server) ? { server, tool } : null;
}
/**
 * The JSON object a Pending You tool answered with: a `tool.call` result's `text` (or a string `result`), or an MCP
 * result's `structuredContent` or text blocks. Null for a refusal, an error, or words that aren't JSON.
 */
export function resultObject(result) {
    if (!isObject(result) || result.deny !== undefined || result.isError === true)
        return null;
    if (isObject(result.structuredContent))
        return result.structuredContent;
    const texts = [];
    const blocks = (value) => {
        if (Array.isArray(value))
            for (const block of value)
                if (isObject(block) && typeof block.text === 'string')
                    texts.push(block.text);
    };
    if (typeof result.text === 'string')
        texts.push(result.text);
    if (typeof result.result === 'string')
        texts.push(result.result);
    else if (isObject(result.result)) {
        if (isObject(result.result.structuredContent))
            return result.result.structuredContent;
        blocks(result.result.content);
    }
    else
        blocks(result.result);
    blocks(result.content);
    for (const each of texts) {
        const parsed = parseJson(each);
        if (isObject(parsed))
            return parsed;
    }
    return null;
}
/** The agent's name on a call: `name`, or post_request's `session.label` (an object, or the same as JSON text). */
export function nameOf(tool, input) {
    const name = text(input.name, 120);
    if (name || tool !== 'post_request')
        return name;
    const session = typeof input.session === 'string' ? parseJson(input.session) : input.session;
    return isObject(session) ? text(session.label, 120) : undefined;
}
/** A tool call's own arguments: the call without the keys Claude Code adds beside them. */
export function argumentsOf(call) {
    const { tool: _tool, tool_use_id: _id, agentId: _agent, consent: _consent, ...rest } = call;
    return rest;
}
export const isClosed = (status) => CLOSED.has(status);
/** The agent's move: their answer or a message is waiting, a fallback ran, or the card closed. */
export const isReady = (state) => state.turn === 'agent' || isClosed(state.status);
export const isWaitingOnYou = (state) => state.turn === 'you' && OPEN.has(state.status);
/** One moment of a card: a new answer, message, status or version is a new moment. */
export const momentOf = (state) => `${state.status}/${state.turn}/${state.version}/${state.cursor}`;
/** A card's state from get_request's answer; null when it isn't one. */
export function stateOf(output) {
    const status = text(output.status, 40);
    const turn = output.turn === 'you' || output.turn === 'agent' ? output.turn : undefined;
    const version = count(output.version);
    if (!status || !turn || version === undefined)
        return null;
    return { status, turn, version, cursor: typeof output.cursor === 'string' ? output.cursor : '' };
}
export const emptyBook = (now = 0) => ({ v: 1, updatedAt: now, cards: {} });
/** A session's list as the store holds it, keeping only what reads as a card; empty for anything else. */
export function readBook(value) {
    if (!isObject(value) || value.v !== 1 || !isObject(value.cards))
        return emptyBook();
    const cards = {};
    for (const [requestId, card] of Object.entries(value.cards)) {
        if (!isObject(card) || card.requestId !== requestId || !requestIdOf(requestId))
            continue;
        if (typeof card.server !== 'string' || !isPendingYou(card.server))
            continue;
        const learnedAt = count(card.learnedAt);
        const changedAt = count(card.changedAt);
        if (learnedAt === undefined || changedAt === undefined)
            continue;
        const state = isObject(card.state) ? stateOf(card.state) : null;
        cards[requestId] = {
            requestId,
            server: card.server,
            learnedAt,
            changedAt,
            ...(text(card.name, 120) ? { name: text(card.name, 120) } : {}),
            ...(text(card.title, 400) ? { title: text(card.title, 400) } : {}),
            ...(state ? { state } : {}),
            ...(typeof card.told === 'string' ? { told: card.told } : {}),
            ...(typeof card.seen === 'string' ? { seen: card.seen } : {}),
            ...(count(card.failures) ? { failures: count(card.failures) } : {}),
            ...(count(card.nextAt) !== undefined ? { nextAt: count(card.nextAt) } : {}),
        };
    }
    return {
        v: 1,
        updatedAt: count(value.updatedAt) ?? 0,
        ...(text(value.name, 120) ? { name: text(value.name, 120) } : {}),
        ...(typeof value.server === 'string' && isPendingYou(value.server)
            ? { server: value.server }
            : {}),
        cards,
    };
}
/** The book with this card in it, keeping MAX_CARDS (the least recently changed go). */
export function put(book, card) {
    const cards = { ...book.cards, [card.requestId]: card };
    const all = Object.values(cards);
    if (all.length > MAX_CARDS)
        for (const old of all
            .sort((a, b) => a.changedAt - b.changedAt)
            .slice(0, all.length - MAX_CARDS))
            delete cards[old.requestId];
    return { ...book, cards };
}
export function drop(book, requestId) {
    if (!book.cards[requestId])
        return book;
    const { [requestId]: _gone, ...cards } = book.cards;
    return { ...book, cards };
}
/** A card the session has just put in front of the person (posted, changed, reopened): checked soon. */
function tracked(book, facts, now) {
    const card = book.cards[facts.requestId];
    const name = facts.name ?? card?.name;
    const title = facts.title ?? card?.title;
    return put(book, {
        requestId: facts.requestId,
        server: facts.server,
        ...(name ? { name } : {}),
        ...(title ? { title } : {}),
        learnedAt: card?.learnedAt ?? now,
        changedAt: now,
        state: facts.state,
        nextAt: now + FAST_MS,
    });
}
/** What the mod learns from one of the session's Pending You calls. Returns the same book when nothing changed. */
export function learn(book, call, now) {
    const { server, tool, input, output } = call;
    if (!output)
        return book;
    const name = nameOf(tool, input);
    let next = book;
    if (name && (book.name !== name || book.server !== server))
        next = { ...next, name, server };
    const requestId = requestIdOf(output.requestId) ?? requestIdOf(input.requestId);
    if (!requestId)
        return next;
    const card = next.cards[requestId];
    const version = count(output.version);
    switch (tool) {
        case 'post_request':
        case 'update_request': {
            const status = text(output.status, 40);
            if (!status || !OPEN.has(status) || version === undefined)
                return next;
            const title = text(input.title, 400);
            return tracked(next, {
                requestId,
                server,
                ...(name ? { name } : {}),
                ...(title ? { title: clip(title) } : {}),
                state: { status, turn: 'you', version, cursor: card?.state?.cursor ?? '' },
            }, now);
        }
        case 'reply_in_thread': {
            const reopen = isObject(input.reopen) ? input.reopen : null;
            if (version === undefined || (!reopen && output.turn !== 'you'))
                return next;
            const title = reopen ? text(reopen.title, 400) : undefined;
            const status = reopen ? 'pending' : (card?.state?.status ?? 'pending');
            const cursor = typeof output.messageId === 'string' ? output.messageId : '';
            return tracked(next, {
                requestId,
                server,
                ...(name ? { name } : {}),
                ...(title ? { title: clip(title) } : {}),
                state: { status: OPEN.has(status) ? status : 'pending', turn: 'you', version, cursor },
            }, now);
        }
        case 'get_request': {
            const state = stateOf(output);
            if (!state)
                return next;
            if (!card)
                return isWaitingOnYou(state)
                    ? tracked(next, { requestId, server, ...(name ? { name } : {}), state }, now)
                    : next;
            // The agent looked for itself: what it saw needs no turn of its own.
            const moment = momentOf(state);
            const changed = !card.state || momentOf(card.state) !== moment;
            return put(next, {
                ...card,
                state,
                ...(changed ? { changedAt: now } : {}),
                ...(isReady(state) ? { seen: moment } : {}),
            });
        }
        case 'ack_answer':
            return output.status === 'resolved' ? drop(next, requestId) : next;
        case 'cancel_request':
            return output.status === 'cancelled' ? drop(next, requestId) : next;
        default:
            return next;
    }
}
/** The card after a check that answered: its new state, and when to look again. */
export function checked(card, output, now) {
    const state = stateOf(output) ?? card.state;
    if (!state)
        return failed(card, now, false);
    const changed = !card.state || momentOf(card.state) !== momentOf(state);
    const changedAt = changed ? now : card.changedAt;
    let wait = now - changedAt < RECENT_MS ? FAST_MS : SLOW_MS;
    // Pending You's own hint, when it's sooner: an answer inside its 5-second hold (it reads as pending until then), or a
    // fallback about to run. Never sooner than 5 seconds: a fallback that's due but hasn't run reads as 1.
    const pollAfter = count(output.pollAfterSeconds);
    if (!isReady(state) && pollAfter !== undefined && pollAfter * 1000 < wait)
        wait = Math.max(HINT_FLOOR_MS, pollAfter * 1000 + 1000);
    const { failures: _failures, ...rest } = card;
    return { ...rest, state, changedAt, nextAt: now + wait };
}
/** The card after a check that failed: tried again later, backing off; `blocked` when Claude Code refused it. */
export function failed(card, now, blocked) {
    if (blocked)
        return { ...card, nextAt: now + BLOCKED_MS };
    const failures = (card.failures ?? 0) + 1;
    return {
        ...card,
        failures,
        nextAt: now + Math.min(MAX_BACKOFF_MS, FAST_MS * 2 ** (failures - 1)),
    };
}
/** The cards due a check now, the most overdue first. */
export function dueCards(book, now) {
    return Object.values(book.cards)
        .filter((card) => !(card.state && isClosed(card.state.status)) && (card.nextAt ?? 0) <= now)
        .sort((a, b) => (a.nextAt ?? 0) - (b.nextAt ?? 0));
}
/** Whether the agent has yet to hear the card's moment: its move, and neither told by the mod nor seen itself. */
export function needsTelling(card) {
    const state = card.state;
    if (!state || !isReady(state))
        return false;
    const moment = momentOf(state);
    if (moment === card.told || moment === card.seen)
        return false;
    // Handled or withdrawn after the agent already heard of it (its own ack or cancel, made elsewhere): nothing new.
    if ((state.status === 'resolved' || state.status === 'cancelled') && (card.told || card.seen))
        return false;
    return true;
}
/** The cards to start a turn for, in the order they changed. */
export const toTell = (book) => Object.values(book.cards)
    .filter(needsTelling)
    .sort((a, b) => a.changedAt - b.changedAt);
/** The book once these cards' moments are told. */
export function told(book, cards) {
    let next = book;
    for (const card of cards) {
        const current = next.cards[card.requestId];
        if (current?.state)
            next = put(next, { ...current, told: momentOf(current.state) });
    }
    return next;
}
/**
 * The book with these cards' moments not told after all (the prompt didn't go), from the cards as they were before
 * `told`: a later tick tries again. A card that moved on since keeps what it has.
 */
export function untold(book, before) {
    let next = book;
    for (const card of before) {
        const current = next.cards[card.requestId];
        if (!current?.state || current.told !== momentOf(current.state))
            continue;
        const { told: _told, ...rest } = current;
        next = put(next, card.told === undefined ? rest : { ...rest, told: card.told });
    }
    return next;
}
/**
 * The book without what's done: closed cards the agent has heard about (or needn't), and anything untouched for
 * KEEP_MS. Returns the same book when nothing goes.
 */
export function settle(book, now) {
    let next = book;
    for (const card of Object.values(book.cards)) {
        const done = card.state && isClosed(card.state.status) && !needsTelling(card);
        if (done || now - Math.max(card.learnedAt, card.changedAt) > KEEP_MS)
            next = drop(next, card.requestId);
    }
    return next;
}
/** Whether a session's list in the store is old enough to forget. */
export const isStale = (book, now) => now - book.updatedAt > KEEP_MS;
const titled = (card) => card.title ? `“${clip(card.title)}” (${card.requestId})` : card.requestId;
const named = (card) => (card.name ? `name “${card.name}”` : 'your name');
/** What happened to a card and what to do, for the prompt: [what happened, what to do]. */
function line(card) {
    const state = card.state;
    const get = `get_request (requestId ${card.requestId}, ${named(card)})`;
    switch (state.status) {
        case 'expired':
            return [
                `nobody answered ${titled(card)} in time, so its fallback is due`,
                'do it now if you haven’t already; there’s nothing to acknowledge',
            ];
        case 'cancelled':
            return [`${titled(card)} was withdrawn`, 'nothing to do'];
        case 'resolved':
            return [`${titled(card)} is already handled`, 'nothing to do'];
        case 'answered':
            return [
                `your person answered ${titled(card)}`,
                `call ${get}, act on their words, then ack_answer with its version and a one-line outcome`,
            ];
        default:
            return [
                `your person wrote to you on ${titled(card)}`,
                `call ${get} to read it, then answer with reply_in_thread`,
            ];
    }
}
const capital = (sentence) => sentence.charAt(0).toUpperCase() + sentence.slice(1);
/** The prompt that wakes the session: short, every card in it, and what to do with each. */
export function wakeText(cards) {
    const asked = cards.some((card) => card.state?.turn === 'agent' && !isClosed(card.state.status));
    const reopen = asked
        ? ' If they asked you something or you need more from them, reply_in_thread with reopen instead.'
        : '';
    if (cards.length === 1) {
        const [happened, todo] = line(cards[0]);
        return `Pending You: ${happened}. ${capital(todo)}.${reopen}`;
    }
    return [
        `Pending You: ${cards.length} of your cards need you.`,
        ...cards.map((card) => {
            const [happened, todo] = line(card);
            return `- ${capital(happened)}: ${todo}.`;
        }),
        ...(reopen ? [reopen.trim()] : []),
    ].join('\n');
}
/**
 * The line under the prompt: the cards waiting on the person, or how to let the mod check; none when there's neither.
 * Claude Code draws it after the plugin's name ("⚠ pending-you: 1 waiting on you"), so it doesn't say Pending You again.
 */
export function statusText(book, blocked) {
    if (blocked)
        return `to hear answers here, allow mcp__${blocked} in /permissions`;
    const waiting = Object.values(book.cards).filter((card) => card.state && isWaitingOnYou(card.state)).length;
    return waiting ? `${waiting} waiting on you` : undefined;
}
/** What the agent reads, once, when Claude Code won't let the mod check its cards. */
export const blockedNote = (server) => `Pending You can’t wake this session when your person answers: Claude Code doesn’t let it check your cards yet. Ask them to allow mcp__${server} in /permissions (Allow, user settings). Until then, check get_request at breakpoints.`;
/** Whether a refused `$.mcp.call` was Claude Code's permission check, not the server. */
export const isRefusal = (error) => /refused|permission|not allowed|haven.t granted/i.test(error instanceof Error ? error.message : String(error));
/**
 * A command line split into words the way a shell splits one simple command (quotes and backslashes, no expansion).
 * Null when it's more than one simple command: a pipe, `&&`, `;`, `&`, a redirect, `$…`, a backtick or a newline.
 */
export function shellWords(command) {
    const words = [];
    let word = '';
    let inWord = false;
    let quote = null;
    for (let index = 0; index < command.length; index++) {
        const char = command[index];
        if (quote === "'") {
            if (char === "'")
                quote = null;
            else
                word += char;
            continue;
        }
        if (quote === '"') {
            if (char === '"')
                quote = null;
            else if (char === '$' || char === '`')
                return null;
            else if (char === '\\' && '"\\$`'.includes(command[index + 1] ?? ''))
                word += command[++index];
            else
                word += char;
            continue;
        }
        if (char === "'" || char === '"') {
            quote = char;
            inWord = true;
        }
        else if (char === '\\') {
            const escaped = command[++index];
            if (escaped === undefined || escaped === '\n')
                return null;
            word += escaped;
            inWord = true;
        }
        else if (char === ' ' || char === '\t') {
            if (inWord)
                words.push(word);
            word = '';
            inWord = false;
        }
        else if (char === '#' && !inWord)
            break;
        else if (';&|<>()`$\n\r'.includes(char))
            return null;
        else {
            word += char;
            inWord = true;
        }
    }
    if (quote)
        return null;
    if (inWord)
        words.push(word);
    return words;
}
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PACKAGE = /^pendingyou(@[\w.^~=<>*-]+)?$/;
const NPX_FLAGS = new Set(['-y', '--yes', '-q', '--quiet', '--prefer-offline', '--prefer-online']);
const OPTION = /^--(origin|timeout)=\S+$/;
/**
 * The request a Bash command holds for: `npx pendingyou hold <id>` in the forms agents and the guide write it
 * (`PENDINGYOU_ORIGIN=… npx -y pendingyou@latest hold <id> --origin … --timeout 4h`), `pendingyou hold <id>`, or the
 * command line's own `"<node>" "…/pendingyou/dist/cli.js" hold <id>`. Null for anything else, a compound command
 * included: that runs as it is.
 */
export function holdOf(command) {
    const words = shellWords(command.trim());
    if (!words?.length)
        return null;
    let index = 0;
    const at = () => words[index] ?? '';
    if (at() === 'env')
        index++;
    while (ASSIGNMENT.test(at()))
        index++;
    if (at() === 'npx') {
        index++;
        while (NPX_FLAGS.has(at()))
            index++;
        if (!PACKAGE.test(at()))
            return null;
        index++;
    }
    else if (at() === 'pnpm' && words[index + 1] === 'dlx') {
        index += 2;
        if (!PACKAGE.test(at()))
            return null;
        index++;
    }
    else if (at() === 'pendingyou')
        index++;
    else {
        if (/(^|\/)node$/.test(at()))
            index++;
        if (!/(^|\/)pendingyou\/dist\/cli\.js$/.test(at()))
            return null;
        index++;
    }
    let requestId = null;
    let held = false;
    while (index < words.length) {
        const word = at();
        if (OPTION.test(word))
            index++;
        else if (word === '--origin' || word === '--timeout') {
            if (index + 1 >= words.length)
                return null;
            index += 2;
        }
        else if (!held && word === 'hold') {
            held = true;
            index++;
        }
        else if (held && !requestId && REQUEST_ID.test(word)) {
            requestId = word;
            index++;
        }
        else
            return null;
    }
    return held ? requestId : null;
}
/** What a hold the mod answered prints: there's nothing to wait on. */
export const holdReply = (requestId) => `Pending You: no hold is needed in this session. It’s woken when your person answers ${requestId}, writes to you on it, or its fallback runs, even while it’s idle. Nothing is running in the background and there’s nothing to wait on: keep working, or end your turn.`;
/** The lease's holder and how long it holds, from the environment variable's value. */
function leaseOf(value) {
    const match = /^(\S+) (\d+)$/.exec(value ?? '');
    return match ? { holder: match[1], until: Number(match[2]) } : null;
}
/** Who holds the lease now; null when nobody does. */
export function leaseHolder(value, now) {
    const lease = leaseOf(value);
    return lease && lease.until > now ? lease.holder : null;
}
/**
 * What to write to take or renew the lease: null when another copy holds it, or this one's needn't be renewed yet.
 * Each copy is named for its plugin: two plugins of one name never load together in one session.
 */
export function claimLease(value, me, now) {
    const lease = leaseOf(value);
    if (lease && lease.until > now && lease.holder !== me)
        return null;
    if (lease && lease.holder === me && lease.until - now > LEASE_MS - RENEW_MS)
        return null;
    return `${me} ${now + LEASE_MS}`;
}
