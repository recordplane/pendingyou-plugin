// The wake mod as Claude Code runs it: `claude plugin test` in a built plugin (or the command line's mod/) loads
// hooks/register.js and fires real events at it, with Claude Code's answers stubbed. The rules themselves are tested
// in the repo (packages/claude-plugin/test/wake.test.ts); this checks the wiring. Synthetic data only.
import { expect, mock, test } from 'claude-code/testing'

/**
 * Whether this build is the command line's copy (`npx pendingyou init`, 0.11.0), which alone starts the setup turn (the
 * plugin has its setup skill): the copy names itself in the session's lease as it starts.
 */
const cliCopy = (env: Map<string, string>) =>
  env.get('PENDINGYOU_WAKE_OWNER')?.split(' ')[0] === 'pendingyou-wake'

const SERVER = 'plugin_pending-you_pendingyou'
const REQ = 'req_00000000000000000001'
const NAME = 'billing-webhooks'
const TITLE = 'How should failed Stripe webhooks be retried?'
const START = Date.parse('2026-10-04T12:00:00.000Z')
const REFUSED = `Claude requested permissions to use mcp__${SERVER}__get_request, but you haven't granted it yet.`

type Card = { status: string; turn: string; version: number }

/** Claude Code's answers: the session, its store and environment, the status line, prompts, and Pending You. */
function world(
  on: Parameters<Parameters<typeof test>[1]>[1],
  options: { refuse?: boolean; lease?: string; setUp?: boolean } = {},
) {
  const clock = mock.clock(on, { now: START })
  const store = new Map<string, unknown>()
  const env = new Map<string, string>(
    options.lease ? [['PENDINGYOU_WAKE_OWNER', options.lease]] : [],
  )
  const card: Card = { status: 'pending', turn: 'you', version: 1 }
  const seen = {
    checks: [] as Record<string, unknown>[],
    prompts: [] as string[],
    status: [] as (string | undefined)[],
    holds: 0,
    /** whoami calls the mod made itself: the command line's copy asking whether setup is finished. */
    whoami: 0,
  }
  on('session.start', () => ({ cwd: '/work' }))
  on('session.id', () => ({ value: 'ses-1' }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('env.get', (_, e) => ({ value: env.get(e.name) }))
  on('env.set', (_, e) => {
    if (e.value === undefined) env.delete(e.name)
    else env.set(e.name, e.value)
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    seen.status.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', (_, e) => {
    seen.prompts.push(e.text)
    return { text: e.text }
  })
  // Claude Code's permission rules: the whole server allowed, or nothing (the mod then never makes the call).
  on('tool.check', () =>
    options.refuse
      ? { decision: 'ask', reason: REFUSED }
      : { decision: 'allow', rule: `mcp__${SERVER}` },
  )
  on('mcp.call', (_, e) => {
    if (options.refuse) throw new Error('the mod called a tool Claude Code had not allowed')
    if (e.tool === 'whoami') {
      seen.whoami++
      const body = { app: { name: 'Claude Code', setUp: options.setUp ?? true } }
      return { value: { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false } }
    }
    seen.checks.push({ server: e.server, tool: e.tool, ...e.args })
    const body = { requestId: REQ, ...card, messages: [], cursor: '', pollAfterSeconds: 30 }
    return { value: { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false } }
  })
  // What the tools answer when the mod lets a call through: Pending You's JSON, or a real hold's output.
  on('tool.call', (_, e) => {
    if (e.tool === 'Bash') {
      seen.holds++
      return { result: { stdout: 'the real hold ran', stderr: '', interrupted: false } }
    }
    const tool = String(e.tool).split('__').at(-1)
    const body =
      tool === 'post_request'
        ? {
            requestId: REQ,
            status: 'pending',
            version: 1,
            pollAfterSeconds: 30,
            url: 'https://example.test',
          }
        : tool === 'ack_answer'
          ? { requestId: REQ, status: 'resolved', version: card.version + 1 }
          : { requestId: REQ, ...card, messages: [], cursor: '', pollAfterSeconds: 30 }
    return { result: JSON.stringify(body), text: JSON.stringify(body) }
  })
  return { clock, store, env, card, seen }
}

const post = {
  tool: `mcp__${SERVER}__post_request`,
  idempotencyKey: 'stripe-retries-1',
  areaId: 'prj_billing',
  session: { label: NAME },
  kind: 'choice',
  title: TITLE,
  summary: 'Stripe retries only when we return an error.',
  blocking: false,
}

test('learns a posted card, shows it waiting, and wakes the idle session once when it’s answered', async ($, on) => {
  const { clock, card, seen, store } = world(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.tool.call(post)
  // Checked at once through the session's own connection, with the agent's name.
  expect(seen.checks[0]).toEqual({
    server: SERVER,
    tool: 'get_request',
    requestId: REQ,
    name: NAME,
  })
  expect(seen.status.at(-1)).toBe('1 waiting on you')
  expect(JSON.stringify(store.get('session:ses-1'))).toContain(REQ)

  await clock.advance(25_000)
  expect(seen.prompts).toEqual([])
  card.status = 'answered'
  card.turn = 'agent'
  card.version = 2
  await clock.advance(25_000)
  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]).toContain(`your person answered “${TITLE}” (${REQ})`)
  expect(seen.prompts[0]).toContain(`get_request (requestId ${REQ}, name “${NAME}”)`)
  expect(seen.prompts[0]).toContain('ack_answer')
  expect(seen.status.at(-1)).toBeUndefined()

  // Once per change: nothing more until the card moves again.
  await clock.advance(120_000)
  expect(seen.prompts).toHaveLength(1)
})

test('answers npx pendingyou hold itself, so nothing waits in the background', async ($, on) => {
  const { seen } = world(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.tool.call(post)
  const hold = await $.tool.call({
    tool: 'Bash',
    command: `npx pendingyou hold ${REQ}`,
    run_in_background: true,
  })
  expect(seen.holds).toBe(0)
  expect(JSON.stringify(hold)).toContain('no hold is needed in this session')
  // Anything else runs as it is.
  await $.tool.call({ tool: 'Bash', command: `npx pendingyou hold ${REQ} && echo done` })
  expect(seen.holds).toBe(1)
})

test('stops tracking a card once the agent acks it, and keeps nothing for the session', async ($, on) => {
  const { clock, card, seen, store } = world(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.tool.call(post)
  expect(store.has('session:ses-1')).toBe(true)
  await $.tool.call({
    tool: `mcp__${SERVER}__ack_answer`,
    requestId: REQ,
    name: NAME,
    expectedVersion: 2,
  })
  expect(store.has('session:ses-1')).toBe(false)
  card.status = 'answered'
  card.turn = 'agent'
  const checks = seen.checks.length
  await clock.advance(120_000)
  expect(seen.checks.length).toBe(checks)
  expect(seen.prompts).toEqual([])
})

test('says how to let it check when Claude Code refuses, and lets the hold run', async ($, on) => {
  const { seen } = world(on, { refuse: true })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const posted = await $.tool.call(post)
  expect(JSON.stringify(posted)).toContain(`allow mcp__${SERVER} in /permissions`)
  expect(seen.status.at(-1)).toBe(`to hear answers here, allow mcp__${SERVER} in /permissions`)
  await $.tool.call({
    tool: 'Bash',
    command: `npx pendingyou hold ${REQ}`,
    run_in_background: true,
  })
  expect(seen.holds).toBe(1)
})

test('leaves the session to the copy that holds it', async ($, on) => {
  const { clock, card, seen } = world(on, { lease: `pendingyou-other ${START + 3_600_000}` })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.tool.call(post)
  card.status = 'answered'
  card.turn = 'agent'
  await clock.advance(60_000)
  expect(seen.checks).toEqual([])
  expect(seen.prompts).toEqual([])
  // Its hold is the other copy's to answer.
  await $.tool.call({ tool: 'Bash', command: `npx pendingyou hold ${REQ}` })
  expect(seen.holds).toBe(1)
})

test('the command line’s copy starts the setup turn once when Pending You says it isn’t set up; the plugin never does', async ($, on) => {
  const { clock, env, seen, store } = world(on, { setUp: false })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.advance(5000)
  if (!cliCopy(env)) {
    expect(seen.whoami).toBe(0)
    expect(seen.prompts).toEqual([])
    return
  }
  expect(seen.whoami).toBe(1)
  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]).toContain('Finish setting up Pending You: it’s connected here already.')
  expect(seen.prompts[0]).toContain('report_setup with source claude-code')
  expect(JSON.stringify(store.get('setup'))).toContain('ses-1')
  // Once: nothing more in this session, however long it runs.
  await clock.advance(120_000)
  expect(seen.prompts).toHaveLength(1)
})

test('the command line’s copy leaves a computer that’s set up alone, and remembers it is', async ($, on) => {
  const { clock, env, seen, store } = world(on, { setUp: true })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.advance(5000)
  expect(seen.prompts).toEqual([])
  if (cliCopy(env)) expect(JSON.stringify(store.get('setup'))).toContain('"done":true')
})

test('no copy starts a turn of its own in a session nobody is at (claude -p)', async ($, on) => {
  const { clock, seen } = world(on, { setUp: false })
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  await clock.advance(5000)
  expect(seen.whoami).toBe(0)
  expect(seen.prompts).toEqual([])
})
