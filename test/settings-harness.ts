/**
 * Exercise the settings read/write contract against fakes shaped like the real
 * Remote and describe mirror.
 *
 * The first version of this plugin read `settings.describe().find(...)` — a
 * synchronous array lookup on a service that is actually an asynchronous,
 * enveloped Remote. It compiled, it shipped, and it failed at the first click
 * with "settings.describe(...).find is not a function". These fakes encode the
 * real shapes so that mistake cannot recur unnoticed.
 *
 * Shapes are transcribed from the shipping bundles:
 * - `dsh-api-remotes` settings.describe result:
 *     { writable, hasDocument, namespaces: [{ autoGenerate, ns, schema, value,
 *       base?, user?, applies, secrets, revision }] }
 * - every Remote call resolves to `{ok:true, value}` or `{ok:false, error:{code, message}}`
 * - a concurrency rejection carries `code: "settings/conflict"`
 */

import { createSettingsAccess } from './settings-entry.js'

let failures = 0
function check(label, actual, expected) {
  const ok = Object.is(actual, expected)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) console.log(`        expected ${String(expected)}, got ${String(actual)}`)
}
function checkThat(label, condition, detail) {
  if (!condition) failures++
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  (${detail})`}`)
}

const NS = 'llm-pi-ai'

/** A describe mirror holding one answer, shaped like the real one. */
function makeMirror(namespaces) {
  return {
    ensure() {},
    getSnapshot: () => ({
      status: 'ready',
      view: { writable: true, hasDocument: true, namespaces },
      error: null,
    }),
  }
}

/** A namespace view with the real field set. */
function nsView(overrides = {}) {
  return {
    autoGenerate: false,
    ns: NS,
    schema: {},
    value: {},
    applies: 'live',
    secrets: [],
    revision: 7,
    user: { providers: { agnes: { models: [{ id: 'x' }] } } },
    ...overrides,
  }
}

console.log('--- reading through the describe mirror ---')
{
  const mirror = makeMirror([nsView()])
  const access = createSettingsAccess(mirror, undefined, NS)
  check('the namespace is found', access.namespaceView()?.ns, NS)
  check('the revision is read', access.revisionOf(), 7)
  checkThat(
    'providers are read from the user layer',
    access.readProviders()?.agnes !== undefined,
  )
}

console.log('\n--- a mirror with no answer yet is not an error ---')
{
  const mirror = {
    ensure() {},
    getSnapshot: () => ({ status: 'idle', view: undefined, error: null }),
  }
  const access = createSettingsAccess(mirror, undefined, NS)
  check('no view', access.namespaceView(), undefined)
  check('no revision', access.revisionOf(), undefined)
  check('no providers', access.readProviders(), undefined)
}

console.log('\n--- the remote fallback carries the same reads ---')
{
  const remote = {
    describe: async () => ({
      ok: true,
      value: { writable: true, hasDocument: true, namespaces: [nsView({ revision: 12 })] },
    }),
    mutate: async () => ({ ok: true, value: {} }),
  }
  const access = createSettingsAccess(undefined, remote, NS)
  await access.refresh()
  check('fallback revision read', access.revisionOf(), 12)
  checkThat('fallback providers read', access.readProviders()?.agnes !== undefined)
}

console.log('\n--- a successful write returns without throwing ---')
{
  const calls = []
  const remote = {
    mutate: async (ns, ops, revision) => {
      calls.push({ ns, ops, revision })
      return { ok: true, value: {} }
    },
  }
  const access = createSettingsAccess(makeMirror([nsView({ revision: 3 })]), remote, NS)
  let threw = false
  try {
    await access.writeModels('agnes', [{ id: 'x' }])
  } catch {
    threw = true
  }
  check('did not throw', threw, false)
  check('one call', calls.length, 1)
  check('addressed the right namespace', calls[0]?.ns, NS)
  check('carried the fence', calls[0]?.revision, 3)
  check('wrote the model array', calls[0]?.ops?.[0]?.path?.join('.'), 'providers.agnes.models')
}

console.log('\n--- a batch write is one call ---')
{
  const calls = []
  const remote = {
    mutate: async (ns, ops, revision) => {
      calls.push({ ns, ops, revision })
      return { ok: true, value: {} }
    },
  }
  const access = createSettingsAccess(makeMirror([nsView({ revision: 9 })]), remote, NS)
  let threw = false
  try {
    await access.writeOps([
      { op: 'set', path: ['providers', 'agnes', 'models'], value: [{ id: 'x' }] },
      { op: 'set', path: ['providers', 'agnes', 'reasoning'], value: 'max' },
      { op: 'unset', path: ['providers', 'bob', 'reasoning'] },
    ])
  } catch {
    threw = true
  }
  check('did not throw', threw, false)
  check('exactly one call for the whole batch', calls.length, 1)
  check('all three operations travelled together', calls[0]?.ops?.length, 3)
  check('the fence is the one that was read', calls[0]?.revision, 9)
  check('the unset survived as an unset', calls[0]?.ops?.[2]?.op, 'unset')
}

console.log('\n--- a batch never reaches a non-volatile path ---')
{
  let called = false
  const remote = {
    mutate: async () => {
      called = true
      return { ok: true, value: {} }
    },
  }
  const access = createSettingsAccess(makeMirror([nsView()]), remote, NS)
  let failed = false
  try {
    await access.writeOps([
      { op: 'set', path: ['providers', 'agnes', 'models'], value: [] },
      { op: 'set', path: ['displayName'], value: 'x' },
    ])
  } catch {
    failed = true
  }
  check('refused', failed, true)
  check('and nothing was sent, not even the valid half', called, false)
}

console.log('\n--- a conflict is retried, not thrown ---')
{
  let attempts = 0
  const remote = {
    mutate: async () => {
      attempts++
      if (attempts < 3) return { ok: false, error: { code: 'settings/conflict', message: 'stale' } }
      return { ok: true, value: {} }
    },
  }
  const access = createSettingsAccess(makeMirror([nsView()]), remote, NS)
  let threw = false
  try {
    await access.writeModels('agnes', [{ id: 'x' }])
  } catch {
    threw = true
  }
  check('eventually succeeded', threw, false)
  check('took three attempts', attempts, 3)
}

console.log('\n--- a non-conflict refusal is surfaced with the Host message ---')
{
  const remote = {
    mutate: async () => ({
      ok: false,
      error: { code: 'settings/refused', message: 'path is not volatile' },
    }),
  }
  const access = createSettingsAccess(makeMirror([nsView()]), remote, NS)
  let message = ''
  try {
    await access.writeModels('agnes', [{ id: 'x' }])
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  check('reported the Host message', message, 'path is not volatile')
}

console.log('\n--- a conflict that never clears gives up after three tries ---')
{
  let attempts = 0
  const remote = {
    mutate: async () => {
      attempts++
      return { ok: false, error: { code: 'settings/conflict', message: 'always stale' } }
    },
  }
  const access = createSettingsAccess(makeMirror([nsView()]), remote, NS)
  let failed = false
  try {
    await access.writeModels('agnes', [{ id: 'x' }])
  } catch {
    failed = true
  }
  check('gave up', failed, true)
  check('exactly three attempts', attempts, 3)
}

console.log('\n--- no remote at all is a clean error, not a crash ---')
{
  const access = createSettingsAccess(makeMirror([nsView()]), undefined, NS)
  let failed = false
  try {
    await access.writeModels('agnes', [{ id: 'x' }])
  } catch {
    failed = true
  }
  check('reported rather than crashed', failed, true)
}

console.log('\n--- a non-volatile path is refused before any write ---')
{
  let called = false
  const remote = {
    mutate: async () => {
      called = true
      return { ok: true, value: {} }
    },
  }
  const access = createSettingsAccess(makeMirror([nsView()]), remote, NS)
  let failed = false
  try {
    await access.writePath(['displayName'], 'x')
  } catch {
    failed = true
  }
  check('refused', failed, true)
  check('never reached the remote', called, false)
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
