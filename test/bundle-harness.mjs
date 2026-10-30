/**
 * Load the shipped client bundle the way the Harness does, and drive it.
 *
 * Two things are checked, and they fail for different reasons:
 *
 * 1. **Static**: the bundle must contain no timer, no observer, no network call
 *    and no DOM listener. That absence is the product requirement — it is what
 *    lets the plugin be deleted without a trace — so it is asserted on the
 *    artifact rather than trusted to code review.
 * 2. **Behavioural**: the card must register in the one official slot, and its
 *    controller must write a complete model array to every external provider
 *    and to nothing else.
 *
 * Usage: node test/bundle-harness.mjs <path-to-lib/client.js>
 */

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const file = process.argv[2]
const source = readFileSync(file, 'utf8')

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`),
  )
}

console.log('--- the bundle carries no runtime footprint ---')
{
  const forbidden = [
    ['setInterval', /setInterval/g],
    ['setTimeout', /setTimeout/g],
    ['MutationObserver', /MutationObserver/g],
    ['ResizeObserver', /ResizeObserver/g],
    ['IntersectionObserver', /IntersectionObserver/g],
    ['a fetch call', /\bfetch\s*\(/g],
    ['XMLHttpRequest', /XMLHttpRequest/g],
    ['WebSocket', /WebSocket/g],
    ['EventSource', /EventSource/g],
    ['addEventListener', /addEventListener/g],
    ['requestAnimationFrame', /requestAnimationFrame/g],
  ]
  for (const [label, pattern] of forbidden) {
    check(`no ${label}`, source.match(pattern)?.length ?? 0, 0)
  }
}

console.log('\n--- load it the way the web shell does ---')
let plugin
{
  const requireStub = (specifier) => {
    if (specifier === 'react') {
      return {
        createElement: (type, props) => ({ type, props }),
        useState: (initial) => [initial, () => {}],
        useCallback: (fn) => fn,
      }
    }
    if (specifier === 'react/jsx-runtime') {
      return {
        jsx: (type, props) => ({ type, props }),
        jsxs: (type, props) => ({ type, props }),
        Fragment: 'Fragment',
      }
    }
    throw new Error(`unexpected require: ${specifier}`)
  }
  globalThis.window = {
    __ModuleLoader__: {
      load({ id, factory }) {
        check('the bundle registers under its package name', id, 'dsh-model-autoconfig')
        plugin = factory(requireStub)
      },
    },
  }
  globalThis.localStorage = { getItem: () => null, setItem: () => {} }
  await import(pathToFileURL(file).href)
}

check('the factory exports apply()', typeof plugin?.apply, 'function')
check('and a name', plugin?.name, 'dsh-model-autoconfig')
check('the injected services are declared', plugin?.inject, [
  'slots',
  'locale',
  'configForms',
  'remote.settings',
])

console.log('\n--- mount against a fake settings plane ---')
const writes = []
const injections = []
let registered

const providers = {
  'deepseek-account': {
    api: 'deepseek-openai',
    models: [{ id: 'deepseek-chat', contextWindow: 128000 }],
  },
  relay: {
    api: 'openai-completions',
    baseURL: 'https://relay.example/v1',
    reasoning: 'low',
    models: [
      { id: 'model-a', contextWindow: 100000, maxTokens: 8000, input: ['text'] },
      { id: 'model-b' },
    ],
  },
}

const ctx = {
  get(name) {
    switch (name) {
      case 'locale':
        return { register: () => () => {}, bind: () => (key) => key }
      case 'configForms':
        return {
          describe: () => ({
            ensure() {},
            getSnapshot: () => ({
              status: 'ok',
              view: {
                writable: true,
                namespaces: [{ ns: 'llm-pi-ai', revision: 7, writable: true, user: { providers } }],
              },
            }),
          }),
        }
      case 'remote.settings':
        return {
          async mutate(ns, ops, revision) {
            writes.push({ ns, ops, revision })
            return { ok: true, value: {} }
          },
        }
      case 'slots':
        return {
          inject(name, callback) {
            injections.push(name)
            callback()
            return () => {}
          },
          register(descriptor, render) {
            registered = { descriptor, render }
            return () => {}
          },
        }
      default:
        return undefined
    }
  },
  effect(body) {
    return body()
  },
}

plugin.apply(ctx)

check('exactly one slot is claimed', injections, ['settings.models.footer'])
check('registered in the official footer slot', registered?.descriptor?.name, 'settings.models.footer')
check('under a stable id', registered?.descriptor?.id, 'model-autoconfig')

const element = registered?.render?.()
check('the seat renders the plugin card', typeof element?.props?.controller?.apply, 'function')
const controller = element.props.controller

console.log('\n--- preview ---')
{
  const preview = controller.preview({ contextWindow: 300000, maxTokens: 64000, image: 'support' })
  check('one external provider in scope', preview.providers, 1)
  check('two model rows', preview.models, 2)
  check('the official route is named as skipped', preview.skipped, ['deepseek-account'])
  check('something would change', preview.changed > 0, true)
  check('settings are writable', preview.writable, true)

  check('an empty form is refused before writing', controller.preview({ image: 'keep' }).problem, 'nothing')
}

console.log('\n--- apply ---')
{
  const outcome = await controller.apply({ contextWindow: 300000, maxTokens: 64000, image: 'support' })
  check('the write reports success', outcome.ok, true)
  check('one provider written', outcome.providers, 1)

  check('exactly one mutate call', writes.length, 1)
  const call = writes[0]
  check('against the pi-ai namespace', call?.ns, 'llm-pi-ai')
  check('fenced against the revision it read', call?.revision, 7)
  check('writing that provider model array', call?.ops?.[0]?.path, ['providers', 'relay', 'models'])

  const models = call?.ops?.[0]?.value
  check('both rows are present', models?.length, 2)
  check('row a got the window', models?.[0]?.contextWindow, 300000)
  check('row a got the output cap', models?.[0]?.maxTokens, 64000)
  check('row a got the image modality', models?.[0]?.input, ['text', 'image'])
  check('row b got everything too', models?.[1]?.input, ['text', 'image'])
  check(
    'nothing addresses an official route',
    writes.some((w) => w.ops[0].path[1].startsWith('deepseek')),
    false,
  )
}

console.log('\n--- apply carries thinking in the same single call ---')
{
  const before = writes.length
  const outcome = await controller.apply({
    image: 'keep',
    thinking: 'on',
    defaultEffort: 'max',
  })
  check('the thinking write reports success', outcome.ok, true)
  check('still exactly one mutate call for everything', writes.length - before, 1)

  const call = writes[writes.length - 1]
  const paths = (call?.ops ?? []).map((op) => op.path.join('.'))
  check('the model array and the default level travel together', paths, [
    'providers.relay.models',
    'providers.relay.reasoning',
  ])

  const effortOp = (call?.ops ?? []).find((op) => op.path[2] === 'reasoning')
  check('the default level is the one that was chosen', effortOp?.value, 'max')

  const rows = (call?.ops ?? []).find((op) => op.path[2] === 'models')?.value ?? []
  check('every row now offers a max level', rows.map((row) => row.reasoningEfforts?.max), ['max', 'max'])
  check('and the lower levels DSH will not guess', rows.map((row) => row.reasoningEfforts?.low), [
    'low',
    'low',
  ])
  check('no official route is addressed', paths.some((path) => path.includes('deepseek')), false)
}

console.log('\n--- clearing the default level ---')
{
  const before = writes.length
  const outcome = await controller.apply({ image: 'keep', defaultEffort: 'clear' })
  check('the clear reports success', outcome.ok, true)
  const call = writes[writes.length - 1]
  const ops = call?.ops ?? []
  const unset = ops.find((op) => op.path[2] === 'reasoning')
  check('one op per provider plus its model array', writes.length - before, 1)
  check('the default level is removed rather than rewritten', unset?.op, 'unset')
  check('and it targets the right path', unset?.path, ['providers', 'relay', 'reasoning'])
}

console.log('\n--- apply with nothing to do ---')
{
  const before = writes.length
  const outcome = await controller.apply({ image: 'keep' })
  check('an empty spec reports a refusal', outcome.ok, false)
  check('and issues no write', writes.length, before)
}

console.log('\n--- the fallback read path (no describe mirror) ---')
{
  let described = 0
  let registered2
  const ctx2 = {
    get(name) {
      switch (name) {
        case 'locale':
          return { register: () => () => {}, bind: () => (key) => key }
        case 'configForms':
          return undefined
        case 'remote.settings':
          return {
            async describe() {
              described += 1
              return {
                ok: true,
                value: {
                  writable: true,
                  namespaces: [{ ns: 'llm-pi-ai', revision: 3, user: { providers } }],
                },
              }
            },
            async mutate() {
              return { ok: true, value: {} }
            },
          }
        case 'slots':
          return {
            inject(name, callback) {
              callback()
              return () => {}
            },
            register(descriptor, render) {
              registered2 = { descriptor, render }
              return () => {}
            },
          }
        default:
          return undefined
      }
    },
    effect(body) {
      return body()
    },
  }

  plugin.apply(ctx2)
  await new Promise((resolve) => setTimeout(resolve, 0))

  check('the fallback issued exactly one round trip', described, 1)
  const controller2 = registered2?.render?.().props?.controller
  check('the card still mounts', typeof controller2?.preview, 'function')
  check(
    'and preview reads the fallback document',
    controller2.preview({ contextWindow: 300000, image: 'keep' }).providers,
    1,
  )
}

console.log('\n--- the host half stays inert ---')
{
  const hostFile = process.argv[3]
  if (hostFile === undefined) {
    check('a host bundle was supplied', false, true)
  } else {
    const host = await import(pathToFileURL(hostFile).href)
    check('the host exports a name', host.name, 'dsh-model-autoconfig')
    let touched = 0
    const spy = new Proxy(
      {},
      {
        get() {
          touched += 1
          return () => {}
        },
      },
    )
    let threw = false
    try {
      host.apply(spy)
    } catch {
      threw = true
    }
    check('apply() does not throw on an empty context', threw, false)
    check('apply() touches no service', touched, 0)
  }
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
