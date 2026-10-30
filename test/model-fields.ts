/**
 * Checks for the plugin's whole logic.
 *
 * `planBulk` is where every safety property lives — the official-route exclusion,
 * the "write nothing that is already true" rule, and the refusal to store a pair
 * that leaves DSH no room to compact. All of it is pure, so it is checked here
 * without a browser.
 */

import {
  formatTokens,
  modelRows,
  pairIsUsable,
  planBulk,
  triggerOf,
} from '../src/client/model-fields.js'

let failures = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` + (ok ? '' : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`),
  )
}

/** A document shaped the way `llm-pi-ai` stores it. */
function document(): Record<string, unknown> {
  return {
    'deepseek-account': {
      api: 'deepseek-openai',
      models: [{ id: 'deepseek-chat', contextWindow: 128000 }],
    },
    'deepseek-official': {
      api: 'deepseek-openai',
      models: [{ id: 'deepseek-reasoner' }],
    },
    relay: {
      api: 'openai-completions',
      baseURL: 'https://relay.example/v1',
      models: [
        { id: 'model-a', contextWindow: 100000, maxTokens: 8000, input: ['text'] },
        { id: 'model-b' },
      ],
    },
    other: {
      api: 'openai-completions',
      models: [{ id: 'model-c', input: ['text', 'image'] }],
    },
    broken: { api: 'openai-completions' },
  }
}

console.log('--- scope: official DeepSeek is never touched ---')
{
  const plan = planBulk(document(), { contextWindow: 300000, image: 'keep' })
  check('two external providers are in scope', plan.providers, 2)
  check('three external model rows seen', plan.models, 3)
  check('both official routes are reported as skipped', plan.skipped, [
    'deepseek-account',
    'deepseek-official',
  ])
  check(
    'no write names an official route',
    plan.writes.filter((w) => w.provider.startsWith('deepseek')).length,
    0,
  )
  check(
    'the provider with no model array is ignored entirely',
    plan.writes.some((w) => w.provider === 'broken'),
    false,
  )
}

console.log('\n--- the three fields ---')
{
  const plan = planBulk(document(), { contextWindow: 300000, maxTokens: 64000, image: 'support' })
  const relay = plan.writes.find((w) => w.provider === 'relay')
  const rows = relay?.models as Array<Record<string, unknown>>
  check('every row gets the window', rows.map((r) => r.contextWindow), [300000, 300000])
  check('every row gets the output cap', rows.map((r) => r.maxTokens), [64000, 64000])
  check('every row gets the image modality', rows.map((r) => r.input), [
    ['text', 'image'],
    ['text', 'image'],
  ])
  check('the id and other fields survive', rows.map((r) => r.id), ['model-a', 'model-b'])
  check('three fields on each of the relay rows', relay?.changed, 6)
}

console.log('\n--- image mode ---')
{
  const textOnly = planBulk(document(), { image: 'text' })
  const relay = textOnly.writes.find((w) => w.provider === 'relay')
  check('"text" writes the text-only array', (relay?.models as any)[1].input, ['text'])

  const keep = planBulk(document(), { image: 'keep', contextWindow: 400000 })
  const other = keep.writes.find((w) => w.provider === 'other')
  check('"keep" leaves an existing image declaration alone', (other?.models as any)[0].input, [
    'text',
    'image',
  ])
  check('a row that only needs the window still gets it', (other?.models as any)[0].contextWindow, 400000)
}

console.log('\n--- nothing is written twice ---')
{
  const first = planBulk(document(), { contextWindow: 300000, maxTokens: 64000, image: 'text' })
  check('the first pass changes rows', first.changed, 8)

  // Re-run against the document the first pass would have produced.
  const after = document()
  for (const write of first.writes) {
    ;(after[write.provider] as Record<string, unknown>).models = write.models
  }
  const second = planBulk(after, { contextWindow: 300000, maxTokens: 64000, image: 'text' })
  check('the second pass writes nothing', second.writes.length, 0)
  check('and changes nothing', second.changed, 0)
}

console.log('\n--- the input document is never mutated ---')
{
  const before = document()
  const snapshot = JSON.stringify(before)
  planBulk(before, { contextWindow: 300000, maxTokens: 64000, image: 'support' })
  check('the original document is byte-identical', JSON.stringify(before), snapshot)
}

console.log('\n--- problems that block the write ---')
{
  check('an empty form is refused', planBulk(document(), { image: 'keep' }).problem, 'nothing')
  check(
    'a non-integer window is refused',
    planBulk(document(), { contextWindow: 1.5, image: 'keep' }).problem,
    'bad-context',
  )
  check(
    'a zero output cap is refused',
    planBulk(document(), { maxTokens: 0, image: 'keep' }).problem,
    'bad-output',
  )
  const impossible = planBulk(document(), { contextWindow: 300000, maxTokens: 300000, image: 'keep' })
  check('a pair that leaves no room is refused', impossible.problem, 'impossible')
  check('and produces no writes', impossible.writes.length, 0)
  check(
    'an empty document is reported',
    planBulk({}, { contextWindow: 300000, image: 'keep' }).problem,
    'no-providers',
  )
}

console.log('\n--- a partial update must not starve an untouched field ---')
{
  // `relay/model-a` currently holds 100K window / 8K output. Lowering the window
  // to 50K without touching the output leaves 50K - 8K - 65,536 < 0, which makes
  // DSH throw on every step. The planner has to catch that before writing.
  const starvedByWindow = planBulk(document(), { contextWindow: 50000, image: 'keep' })
  check('a window that starves the existing output cap is refused', starvedByWindow.problem, 'impossible')
  check('and every starved row is named', starvedByWindow.offenders, [
    'relay/model-a',
    'relay/model-b',
    'other/model-c',
  ])
  check('and nothing is written', starvedByWindow.writes.length, 0)

  // The mirror case: a huge output cap against an untouched window.
  const starvedByOutput = planBulk(document(), { maxTokens: 900000, image: 'keep' })
  check('an output cap larger than the window is refused', starvedByOutput.problem, 'impossible')
  check('the same model is named', starvedByOutput.offenders.includes('relay/model-a'), true)

  // A partial update that leaves room is fine.
  const fine = planBulk(document(), { contextWindow: 400000, image: 'keep' })
  check('a partial update with room is allowed', fine.problem, undefined)
  check('and writes', fine.writes.length, 2)

  // A row that declares no cap is not uncapped: DSH assumes 32,768. A small
  // window then starves compaction even though the form only mentioned a window.
  const implicitCap = planBulk(
    { relay: { api: 'openai-completions', models: [{ id: 'no-cap' }] } },
    { contextWindow: 90000, image: 'keep' },
  )
  check('the implicit 32K cap is taken into account', implicitCap.problem, 'impossible')
  check('and names the row', implicitCap.offenders, ['relay/no-cap'])

  // The same window is fine once the provider declares a smaller default cap.
  const declaredCap = planBulk(
    { relay: { api: 'openai-completions', defaultMaxTokens: 8000, models: [{ id: 'no-cap' }] } },
    { contextWindow: 90000, image: 'keep' },
  )
  check('a provider-level default cap is used instead', declaredCap.problem, undefined)

  // A row that is already broken but untouched must not block an unrelated edit.
  const alreadyBroken = planBulk(
    { relay: { models: [{ id: 'broken', contextWindow: 50000, maxTokens: 40000 }] } },
    { image: 'support' },
  )
  check('an untouched broken row does not block a non-capacity edit', alreadyBroken.problem, undefined)
}

console.log('\n--- the compaction trigger DSH will compute ---')
{
  check('300K window / 128K output triggers at 106,464', triggerOf(300000, 128000), 106464)
  check('300K / 64K triggers at 170,464', triggerOf(300000, 64000), 170464)
  check('1M / 64K triggers at 800,000 (the 80% term wins)', triggerOf(1000000, 64000), 800000)
  check('a pair with no room is unusable', pairIsUsable(300000, 300000), false)
  check('an ordinary pair is usable', pairIsUsable(300000, 64000), true)
  check('a trigger reads with separators', formatTokens(106464), '106,464')
}

console.log('\n--- modelRows ---')
{
  check('a missing array is undefined', modelRows({ api: 'x' }), undefined)
  check('a non-array is undefined', modelRows({ models: 'nope' }), undefined)
  check('a non-object is undefined', modelRows(null), undefined)
  check('an empty array is an array', Array.isArray(modelRows({ models: [] })), true)
}

console.log('\n--- thinking: the switch fills in the levels DSH will not guess ---')
{
  /** One external provider whose rows declare different reasoning shapes. */
  const doc = (): Record<string, unknown> => ({
    'deepseek-account': { models: [{ id: 'deepseek-chat', reasoningEfforts: false }] },
    relay: {
      api: 'openai-completions',
      reasoning: 'high',
      models: [
        { id: 'only-max', reasoningEfforts: { max: 'max' } },
        { id: 'has-medium', reasoningEfforts: { medium: 'medium', max: 'max' } },
        { id: 'null-max', reasoningEfforts: { max: null } },
        { id: 'off-model', reasoningEfforts: false },
        { id: 'undeclared' },
      ],
    },
  })

  const on = planBulk(doc(), { image: 'keep', thinking: 'on' })
  const rows = on.writes[0]?.models ?? []
  const byId = (id: string): Record<string, unknown> =>
    (rows.find((row) => (row as { id?: string }).id === id) ?? {}) as Record<string, unknown>

  check('switching on writes one provider', on.writes.length, 1)
  check('a model declaring only max gains low and high', byId('only-max').reasoningEfforts, {
    low: 'low',
    high: 'high',
    max: 'max',
  })
  check('an extra declared level survives', byId('has-medium').reasoningEfforts, {
    low: 'low',
    high: 'high',
    max: 'max',
    medium: 'medium',
  })
  check('a null max is repaired rather than left unselectable', byId('null-max').reasoningEfforts, {
    low: 'low',
    high: 'high',
    max: 'max',
  })
  check('a non-reasoning model is switched on', byId('off-model').reasoningEfforts, {
    low: 'low',
    high: 'high',
    max: 'max',
  })
  check('an undeclared model is switched on', byId('undeclared').reasoningEfforts, {
    low: 'low',
    high: 'high',
    max: 'max',
  })
  check('the official route is not switched on', on.skipped, ['deepseek-account'])

  // DSH refuses a non-`off` level with no wire value, and a refused declaration
  // hides every model on the route. Repairing it is the only safe outcome.
  const dirty = planBulk(
    {
      relay: {
        models: [
          { id: 'null-xhigh', reasoningEfforts: { xhigh: null, max: 'max' } },
          { id: 'empty-medium', reasoningEfforts: { medium: '', max: 'max' } },
          { id: 'null-off', reasoningEfforts: { off: null, max: 'max' } },
        ],
      },
    },
    { image: 'keep', thinking: 'on' },
  )
  const dirtyRows = (dirty.writes[0]?.models ?? []) as Record<string, unknown>[]
  const effortsOf = (id: string): unknown =>
    (dirtyRows.find((row) => row.id === id) ?? {}).reasoningEfforts
  check('a null xhigh is dropped rather than kept invalid', effortsOf('null-xhigh'), {
    low: 'low',
    high: 'high',
    max: 'max',
  })
  check('an empty medium is dropped', effortsOf('empty-medium'), {
    low: 'low',
    high: 'high',
    max: 'max',
  })
  check('an explicit off level survives', effortsOf('null-off'), {
    low: 'low',
    high: 'high',
    max: 'max',
    off: null,
  })

  // Idempotence: the document the first pass produces must need no second pass.
  const after = doc()
  ;(after.relay as { models: readonly unknown[] }).models = rows
  check('a second switch-on writes nothing', planBulk(after, { image: 'keep', thinking: 'on' }).writes.length, 0)

  const off = planBulk(doc(), { image: 'keep', thinking: 'off' })
  const offRows = off.writes[0]?.models ?? []
  check('switching off turns every row off', offRows.every((row) => (row as { reasoningEfforts?: unknown }).reasoningEfforts === false), true)

  check('leave-alone changes nothing', planBulk(doc(), { image: 'keep', thinking: 'keep' }).writes.length, 0)
}

console.log('\n--- the provider default level ---')
{
  const doc = (): Record<string, unknown> => ({
    'deepseek-official': { reasoning: 'low', models: [{ id: 'deepseek-reasoner' }] },
    relay: {
      api: 'openai-completions',
      reasoning: 'low',
      models: [{ id: 'model-a', contextWindow: 400000, maxTokens: 64000, reasoningEfforts: { max: 'max' } }],
    },
    second: { api: 'openai-completions', models: [{ id: 'model-b' }] },
  })

  const plan = planBulk(doc(), { image: 'keep', thinking: 'on', defaultEffort: 'max' })
  check('the changed provider carries a new default', plan.writes.map((w) => [w.provider, w.reasoning]), [
    ['relay', 'max'],
    ['second', 'max'],
  ])
  check('the official route keeps its own default', plan.skipped, ['deepseek-official'])

  // A provider already holding the level must not be written again. It may still
  // appear for its model rows, but never carrying a redundant default.
  const same = doc()
  ;(same.relay as { reasoning: string }).reasoning = 'max'
  const partial = planBulk(same, { image: 'keep', thinking: 'on', defaultEffort: 'max' })
  check('an already-set default is not rewritten', partial.writes.find((w) => w.provider === 'relay')?.reasoning, undefined)

  // Thinking off makes a default level meaningless, so it is not written.
  const offPlan = planBulk(doc(), { image: 'keep', thinking: 'off', defaultEffort: 'max' })
  check('no default is written while thinking is off', offPlan.writes.every((w) => w.reasoning === undefined), true)

  check('an unknown level is refused', planBulk(doc(), { image: 'keep', defaultEffort: 'ultra' as never }).problem, 'bad-effort')

  // DSH's own models page has no field for `providers.<route>.reasoning`, so a
  // value this plugin writes has to be removable by this plugin too.
  const cleared = planBulk(doc(), { image: 'keep', defaultEffort: 'clear' })
  check('clearing flags the provider that holds a level', cleared.writes.map((w) => [w.provider, w.clearReasoning]), [
    ['relay', true],
  ])
  check('and never carries a level to set', cleared.writes.some((w) => w.reasoning !== undefined), false)

  const nothingToClear = doc()
  delete (nothingToClear.second as { reasoning?: string }).reasoning
  check(
    'a provider with no level is not touched by a clear',
    planBulk(nothingToClear, { image: 'keep', defaultEffort: 'clear' }).writes.some(
      (w) => w.provider === 'second' && w.clearReasoning === true,
    ),
    false,
  )

  check(
    'clearing still works while thinking is off',
    planBulk(doc(), { image: 'keep', thinking: 'off', defaultEffort: 'clear' }).writes.some(
      (w) => w.clearReasoning === true,
    ),
    true,
  )
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
