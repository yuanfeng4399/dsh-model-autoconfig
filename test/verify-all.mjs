/**
 * The build gate.
 *
 * Runs every check against the **built artifacts**, in the order a failure
 * matters: the bundle must load the way the host loads it, and the planning
 * logic must hold.
 *
 * Usage: node test/verify-all.mjs
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/** Every check, with the arguments it needs. */
const CHECKS = [
  // Runs the shipped bundles the way the Harness does: loader contract, a
  // context shaped like the client's, and the exact envelope a write produces.
  // This is the check that catches a bundle that loads but registers nothing.
  {
    name: 'bundles load, register one card, and write the right thing',
    script: 'test/bundle-harness.mjs',
    args: ['lib/client.js', 'lib/index.js'],
  },
  { name: 'bulk planning and scope', script: 'test/out/model-fields.mjs' },
  { name: 'the card renders and its states are sane', script: 'test/out/card-render.mjs' },
  { name: 'settings contract', script: 'test/out/settings-harness.mjs' },
]

let failed = 0

for (const check of CHECKS) {
  const script = join(root, check.script)
  if (!existsSync(script)) {
    console.log(`SKIP  ${check.name}  (${check.script} not built)`)
    failed++
    continue
  }
  const args = [script]
  for (const extra of check.args ?? []) {
    args.push(extra.startsWith('lib/') ? join(root, extra) : extra)
  }
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' })
  const ok = result.status === 0
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${check.name}`)
  if (!ok) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    console.log(
      output
        .split('\n')
        .filter((line) => line.includes('FAIL') || /Error|error:/.test(line))
        .slice(0, 12)
        .map((line) => `        ${line.trim()}`)
        .join('\n'),
    )
  }
}

console.log(`\n${CHECKS.length - failed}/${CHECKS.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
