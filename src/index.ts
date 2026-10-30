/**
 * Host half of dsh-model-autoconfig.
 *
 * The feature is deliberately client-only. models.dev publishes its catalog
 * with `access-control-allow-origin: *`, so the browser half can fetch and
 * cache it directly; nothing needs to cross the Host boundary, and no settings
 * are written from here.
 *
 * This entry exists because a bundle's `cordis.patch.yml` mounts a package by
 * name, which resolves the package `main`. It therefore must load cleanly and
 * do nothing: no services, no events, no configuration access.
 *
 * What that does and does not buy, stated plainly because the difference is easy
 * to get wrong: disabling the plugin removes its code, its settings UI and its
 * mutation observer, and stops all future writes. It does **not** revert the
 * model capacities already sitting in `llm-pi-ai` — those are read from the
 * profile's patch file on every boot, with or without this plugin loaded. A
 * compaction trigger that was widened to 280K tokens stays widened at 280K after
 * the plugin is switched off, and so does the slower time-to-first-token that
 * comes with it. Reverting means editing those numbers, not toggling this flag.
 *
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-model-autoconfig'

/**
 * Mount point. Intentionally inert — see the module doc.
 * @param _ctx - the Host context, unused.
 */
export function apply(_ctx: Context): void {
  // No Host behaviour by design.
}
