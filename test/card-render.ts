/**
 * Render the card for real.
 *
 * The bundle harness proves the controller writes the right thing, but it never
 * runs the component: it stubs `createElement`. A crash inside render — a hook
 * order mistake, a missing translation key, a preview that throws — would ship
 * as a blank settings page. This renders the component to static markup with
 * real React and checks what a person would actually see.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AutoConfigCard, type CardController, type ScopePreview } from '../src/client/components/Card.js'
import { en, zh } from '../src/client/locales.js'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (!condition) failures++
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${condition || detail === undefined ? '' : `  (${String(detail)})`}`)
}

/**
 * A translation that echoes the key, so assertions can look for keys — and that
 * fails loudly when a key is missing from either locale. A missing key renders
 * its raw name in the UI, which is exactly the kind of defect a static render
 * can catch before a person sees it.
 */
const t = (key: string): string => {
  if (!(key in zh) || !(key in en)) throw new Error(`missing translation key: ${key}`)
  return key
}

function render(preview: Partial<ScopePreview>, apply?: CardController['apply']): string {
  const scope: ScopePreview = {
    providers: 0,
    models: 0,
    changed: 0,
    skipped: [],
    offenders: [],
    missing: false,
    writable: true,
    ...preview,
  }
  const controller: CardController = {
    preview: () => scope,
    apply: apply ?? (async () => ({ ok: true, changed: 0, providers: 0 })),
  }
  // The component must be handed to React, not called: invoking it directly
  // takes the hooks out of a render and throws "invalid hook call".
  return renderToStaticMarkup(createElement(AutoConfigCard, { controller, t }))
}

console.log('--- the card renders at all ---')
{
  let markup = ''
  let threw: unknown
  try {
    markup = render({
      providers: 8,
      models: 9,
      changed: 18,
      skipped: [],
      missing: false,
      writable: true,
    })
  } catch (error) {
    threw = error
  }
  check('renderToStaticMarkup does not throw', threw === undefined, threw)

  check('the title is present', markup.includes('cardTitle'))
  check('the intro is present', markup.includes('cardIntro'))
  check('all three field labels are present',
    markup.includes('fieldContext') && markup.includes('fieldOutput') && markup.includes('fieldImage'))
  check('the three image options are present',
    markup.includes('imageKeep') && markup.includes('imageSupport') && markup.includes('imageText'))
  check('the apply button is present', markup.includes('apply'))
  check('the scope readout is present', markup.includes('scope'))
  check('the persist note is always shown', markup.includes('persistNote'))
  check('the thinking control is present', markup.includes('fieldThinking'))
  check('all three thinking choices are present',
    markup.includes('thinkingOn') && markup.includes('thinkingOff') && markup.includes('thinkingKeep'))
  check('the default-level control is present', markup.includes('fieldEffort'))
  check('and offers "not set" plus the levels it always writes',
    markup.includes('effortUnset') && markup.includes('>low<') && markup.includes('>high<') && markup.includes('>max<'))
  check('thinking defaults to on, so its hint shows', markup.includes('thinkingNote'))
}

console.log('\n--- the popup is readable, not white on white ---')
{
  const markup = render({
    providers: 8,
    models: 9,
    changed: 18,
    skipped: [],
    missing: false,
    writable: true,
  })

  const options = markup.match(/<option[^>]*>/g) ?? []
  check('every option exists', options.length > 0)
  check(
    'every option carries its own background',
    options.every((tag) => tag.includes('background:')),
    options.filter((tag) => !tag.includes('background:')).length,
  )
  check(
    'every option carries its own text colour',
    options.every((tag) => tag.includes('color:')),
    options.filter((tag) => !tag.includes('color:')).length,
  )

  const selects = markup.match(/<select[^>]*>/g) ?? []
  check('all three selects render', selects.length === 3, selects.length)
  check(
    'every select paints an opaque background, which is what the popup inherits',
    selects.every((tag) => /background:var\(--dsw-alias-bg-layer-1/.test(tag)),
    selects.map((tag) => tag.slice(0, 120)),
  )

  // A token that does not exist silently falls back, which is how the popup
  // ended up transparent in the first place.
  const tokens = [...markup.matchAll(/--dsw-[a-z0-9-]+/g)].map((match) => match[0])
  const invented = [...new Set(tokens)].filter(
    (token) => !/^--dsw-(alias|radius|specific)-/.test(token),
  )
  check('every theme token used is a real DSH token family', invented.length === 0, invented)

  // The models page has no top-of-page slot; the card sits in the footer slot and
  // is ordered first. Losing this puts it back at the bottom of the page.
  check('the card asks to be laid out first', /order:\s*-1/.test(markup))
}

console.log('\n--- the button is enabled only when a write is possible ---')
{
  const ready = render({
    providers: 8,
    models: 9,
    changed: 18,
    skipped: [],
    missing: false,
    writable: true,
  })
  check('a real change enables the button', !/disabled/.test(ready))

  const unchanged = render({
    providers: 8,
    models: 9,
    changed: 0,
    skipped: [],
    missing: false,
    writable: true,
  })
  check('nothing to change disables it', /disabled/.test(unchanged))

  const readOnly = render({
    providers: 8,
    models: 9,
    changed: 18,
    skipped: [],
    missing: false,
    writable: false,
  })
  check('a read-only document disables it', /disabled/.test(readOnly))
  check('and says so', readOnly.includes('readOnly'))
}

console.log('\n--- the states a person will actually hit ---')
{
  // What the controller returns before the user types anything: the form has
  // requested nothing yet, which is a distinct state from "no providers".
  const empty = render({
    providers: 0,
    models: 0,
    changed: 0,
    skipped: [],
    missing: false,
    writable: true,
    problem: 'nothing',
  })
  check('an untouched form explains itself instead of shouting', empty.includes('nothing'))
  check('and the button is disabled', /disabled/.test(empty))

  const noProviders = render({
    providers: 0,
    models: 0,
    changed: 0,
    skipped: [],
    missing: false,
    writable: true,
    problem: 'no-providers',
  })
  check('an empty document points at the add-provider flow', noProviders.includes('noProviders'))

  const missing = render({ providers: 0, models: 0, changed: 0, skipped: [], missing: true, writable: false })
  check('an unreachable settings service is reported', missing.includes('noSettings'))

  const impossible = render({
    providers: 8,
    models: 9,
    changed: 0,
    skipped: [],
    missing: false,
    writable: true,
    problem: 'impossible',
  })
  check('an impossible pair is reported', impossible.includes('impossible'))
  check('and the button is disabled', /disabled/.test(impossible))

  const skipped = render({
    providers: 8,
    models: 9,
    changed: 18,
    skipped: ['deepseek-account'],
    missing: false,
    writable: true,
  })
  check('skipped official routes are named', skipped.includes('skippedNote'))
}

console.log('\n--- the click path ---')
{
  let called = 0
  const markup = render(
    { providers: 1, models: 1, changed: 2, skipped: [], missing: false, writable: true },
    async () => {
      called += 1
      return { ok: true, changed: 2, providers: 1 }
    },
  )
  check('the enabled button is rendered as a submit-safe button', markup.includes('type="button"'))
  check('no write happens during render', called === 0, called === 0 ? undefined : `called ${called}`)
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
