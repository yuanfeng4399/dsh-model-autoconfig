/**
 * Client half of dsh-model-autoconfig.
 *
 * Mounts one card and nothing else. The whole plugin is: read `llm-pi-ai`'s
 * providers from the settings mirror, and on one click write a fresh model array
 * for each external provider.
 *
 * There is deliberately no timer, no `MutationObserver`, no network request and
 * no DOM injection here. That is what makes removing the bundle leave DSH
 * exactly as it was, apart from the model values the user asked to change.
 *
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import { createElement } from 'react'
import { NS, en, zh } from './locales.js'
import { planBulk, type BulkSpec } from './model-fields.js'
import {
  createSettingsAccess,
  type DescribeFace,
  type SettingsOp,
  type SettingsRemote,
} from './settings-access.js'
import {
  AutoConfigCard,
  type ApplyOutcome,
  type CardController,
  type ScopePreview,
} from './components/Card.js'

export const name = 'dsh-model-autoconfig'

/**
 * Required services; each is optional so absence degrades quietly.
 *
 * `remote.settings` is a **dotted service name**, not a property path. DSH's own
 * `ui-settings-models` injects exactly this string. Reaching it as
 * `get('remote').settings` instead looks equivalent and is not: a Cordis context
 * is a proxy that treats an unknown property as a service lookup, so that form
 * throws `cannot get property "remote.settings" without inject` — during
 * `apply()`, which fails the loader entry and takes the whole web UI boot with
 * it. Naming every service here is what makes `apply()` run only once its
 * dependencies are actually available.
 */
export const inject = ['slots', 'locale', 'configForms', 'remote.settings'] as const

/** The settings namespace that owns custom pi-ai routes. */
const API_NS = 'llm-pi-ai'

interface SlotsService {
  inject(name: string, callback: () => () => void): () => void
  register(descriptor: Record<string, unknown>, render: unknown): () => void
}

interface LocaleService {
  register(ns: string, dictionaries: Record<string, Record<string, string>>): () => void
  bind(ns: string): (key: string, params?: Record<string, unknown>) => string
}

/** Where the last failures are kept, for reading back after a restart. */
const FAILURE_KEY = 'dsh-model-autoconfig:last-failure'

/**
 * Report a failure without letting it escape.
 *
 * A third-party plugin must never be able to stop DSH from booting. The web boot
 * gate treats a throwing `apply()` as a failed entry and aborts the whole UI —
 * `web boot: 1 entry did not activate` — which is a far worse outcome than a
 * feature that quietly does nothing. So every step below is isolated, and a
 * failure is *reported* rather than thrown: the feature degrades, the host does
 * not.
 *
 * @param scope - the step that failed.
 * @param error - whatever it threw.
 */
function reportFailure(scope: string, error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  try {
    globalThis.console?.error?.(`[dsh-model-autoconfig] ${scope} failed:`, error)
  } catch {
    // Reporting must not itself throw.
  }
  try {
    const store = globalThis.localStorage
    if (store !== undefined) {
      const previous = store.getItem(FAILURE_KEY)
      const line = JSON.stringify({ scope, message, at: new Date().toISOString() })
      const kept = previous === null ? [] : previous.split('\n').slice(-4)
      store.setItem(FAILURE_KEY, [...kept, line].join('\n'))
    }
  } catch {
    // Storage is best-effort.
  }
}

/**
 * Run one setup step, reporting instead of throwing.
 *
 * @param scope - the step name, for the report.
 * @param step - the step itself.
 */
function guard(scope: string, step: () => unknown): void {
  try {
    step()
  } catch (error) {
    reportFailure(scope, error)
  }
}

/**
 * Mount the plugin.
 *
 * This outer boundary is load-bearing rather than defensive habit: a throw here
 * fails the loader entry and takes the entire web UI down with it.
 *
 * @param ctx - the client root context.
 */
export function apply(ctx: Context): void {
  guard('apply', () => {
    applyInner(ctx)
  })
}

/** The real body; see {@link apply} for why it is wrapped. */
function applyInner(ctx: Context): void {
  const services = ctx as unknown as {
    get(name: string): unknown
  }
  const configForms = services.get('configForms') as { describe(): DescribeFace } | undefined
  const remoteSettings = services.get('remote.settings') as SettingsRemote | undefined
  const slots = services.get('slots') as SlotsService | undefined
  const locale = services.get('locale') as LocaleService | undefined

  if (locale !== undefined) {
    // `register` throws when the namespace/locale pair is already taken, and a
    // locale service that changed shape would throw on `bind`. Copy is a nicety;
    // losing it must not cost the host its boot.
    guard('locale copy', () => {
      ctx.effect(() => locale.register(NS, { zh, en }), 'model-autoconfig: copy')
    })
  }

  let t: (key: string, params?: Record<string, unknown>) => string = (key, params) => {
    const table = (zh as Record<string, string>)[key] ?? key
    return params === undefined
      ? table
      : table.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`))
  }
  if (locale !== undefined) {
    try {
      t = locale.bind(NS)
    } catch (error) {
      reportFailure('locale bind', error)
    }
  }

  /**
   * `ctx.effect` behind a failure boundary.
   *
   * `ctx.effect` runs its callback synchronously, and `slots.inject` **rethrows
   * a callback's failure straight through it** — so one refused slot
   * registration would fail this loader entry and, with it, the entire web UI
   * boot. Registering through here keeps a single bad seat from taking the host
   * down; the argument order matches `ctx.effect` exactly.
   */
  const effect = (body: () => unknown, label: string): void => {
    guard(label, () => {
      const register = ctx.effect as unknown as (
        execute: () => unknown,
        label: string,
      ) => unknown
      register(body, label)
    })
  }

  /**
   * Resolve the describe mirror without letting its absence — or a throwing
   * accessor — take the whole plugin down.
   */
  const guessMirror = (): DescribeFace | undefined => {
    if (configForms === undefined) return undefined
    try {
      const face = configForms.describe()
      if (face === undefined || typeof face.getSnapshot !== 'function') return undefined
      return face
    } catch {
      return undefined
    }
  }

  const mirror = guessMirror()
  const settings = createSettingsAccess(mirror, remoteSettings, API_NS)

  // Only when the mirror is unavailable does a read have to be issued; with the
  // mirror present the settings page has already answered and this stays free.
  if (mirror === undefined && remoteSettings !== undefined) {
    effect(() => {
      void settings.refresh()
    }, 'model-autoconfig: initial read')
  }

  const controller: CardController = {
    preview: (spec: BulkSpec): ScopePreview => {
      const view = settings.namespaceView()
      if (view === undefined) {
        return {
          providers: 0,
          models: 0,
          changed: 0,
          skipped: [],
          offenders: [],
          missing: true,
          writable: false,
        }
      }
      const plan = planBulk(settings.readProviders() ?? {}, spec)
      return {
        providers: plan.providers,
        models: plan.models,
        changed: plan.changed,
        skipped: plan.skipped,
        offenders: plan.offenders,
        missing: false,
        writable: view.writable !== false,
        ...(plan.problem === undefined ? {} : { problem: plan.problem }),
      }
    },

    apply: async (spec: BulkSpec): Promise<ApplyOutcome> => {
      const providers = settings.readProviders()
      if (providers === undefined) return { ok: false, reason: 'no-settings' }

      const plan = planBulk(providers, spec)
      if (plan.problem !== undefined) {
        return { ok: false, reason: 'refused', message: plan.problem }
      }

      // One mutate call for every provider. The Remote commits a call as a
      // single revision bump, so this either lands whole or not at all — no
      // half-written configuration to reason about after a failure.
      const ops: SettingsOp[] = []
      for (const write of plan.writes) {
        ops.push({ op: 'set', path: ['providers', write.provider, 'models'], value: write.models })
        if (write.reasoning !== undefined) {
          ops.push({ op: 'set', path: ['providers', write.provider, 'reasoning'], value: write.reasoning })
        }
        if (write.clearReasoning === true) {
          ops.push({ op: 'unset', path: ['providers', write.provider, 'reasoning'] })
        }
      }
      if (ops.length === 0) return { ok: true, changed: 0, providers: 0 }

      try {
        await settings.writeOps(ops)
      } catch (error) {
        return {
          ok: false,
          reason: 'refused',
          message: error instanceof Error ? error.message : String(error),
        }
      }
      return { ok: true, changed: plan.changed, providers: plan.writes.length }
    },
  }

  if (slots !== undefined) {
    /**
     * `slots.register` that never throws.
     *
     * The slot core refuses a registration for several legitimate reasons — an
     * undeclared key, or a key/id already taken at this priority — and
     * `slots.inject` rethrows that refusal straight through `ctx.effect`, where
     * it would otherwise fail this loader entry and, with it, the whole web UI
     * boot. A refused seat costs one card; it must not cost the host.
     */
    const safeRegister = (descriptor: Record<string, unknown>, render: unknown): (() => void) => {
      try {
        return slots.register(descriptor, render)
      } catch (error) {
        reportFailure(`slot ${String(descriptor.name)}`, error)
        return () => {}
      }
    }

    effect(
      () =>
        slots.inject('settings.models.footer', () =>
          safeRegister({ name: 'settings.models.footer', id: 'model-autoconfig', order: 40 }, () =>
            createElement(AutoConfigCard, { controller, t }),
          ),
        ),
      'model-autoconfig: settings card',
    )
  }
}
