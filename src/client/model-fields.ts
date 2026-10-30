/**
 * The plugin's entire logic, kept pure so it is testable without a browser.
 *
 * There is exactly one job: take a small form and write it onto every model row
 * of every *external* provider.
 *
 * Three rules carry all the safety:
 *
 * 1. **Only externally declared providers are touched.** DSH's own DeepSeek
 *    routes live in a different settings namespace and are excluded here as
 *    well, so the guarantee does not depend on the caller remembering it.
 * 2. **Nothing is written that is already true.** A provider whose rows already
 *    hold the requested values produces no write at all, which keeps the
 *    settings revision still and makes a repeated click free.
 * 3. **A change never leaves DSH unable to compact.** The window/output pair is
 *    checked per row *after* the edit, because setting only one of the two can
 *    starve the other.
 *
 * @module
 */

/** Routes owned by DSH's own adapters rather than declared by the user. */
const ADAPTER_OWNED_ROUTES: ReadonlySet<string> = new Set([
  'deepseek-account',
  'deepseek-official',
])

/**
 * Tokens DSH reserves on top of the output cap before compaction may run.
 *
 * Mirrors `compaction-basic`'s default `headroomTokens`. It is only used for the
 * read-only trigger readout and for catching a self-defeating pair; nothing here
 * writes it anywhere.
 */
export const HEADROOM_TOKENS = 65_536

/** `compaction-basic`'s default threshold ratio. */
export const THRESHOLD_RATIO = 0.8

/**
 * The output cap DSH assumes for a model that declares none.
 *
 * Mirrors `DEFAULT_MAX_TOKENS` in `dsh-llm-pi-ai`. It matters for the safety
 * check: a row with no explicit cap is not "no cap", it is 32,768.
 */
export const DEFAULT_MAX_TOKENS = 32_768

/** The window DSH assumes for a model that declares none. */
export const DEFAULT_CONTEXT_WINDOW = 262_144

/**
 * Every thinking level DSH accepts, in its own escalation order.
 *
 * Mirrors `THINKING_LEVELS` in `dsh-llm-pi-ai`. Only `off` may carry an empty
 * wire value; every other level needs the string the provider is sent.
 */
export const THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

/** One selectable thinking level. */
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/**
 * The levels written when thinking is switched on.
 *
 * These are the three a DeepSeek-style relay is known to accept, and `max` is
 * the point of the exercise: DSH only offers `xhigh` and `max` when a model
 * declares them explicitly, so a model without `max` in `reasoningEfforts` can
 * never be asked for it.
 */
const THINKING_BASELINE: Readonly<Record<string, string>> = {
  low: 'low',
  high: 'high',
  max: 'max',
}

/** What to do about image input. `keep` leaves the declaration untouched. */
export type ImageMode = 'support' | 'text' | 'keep'

/** What to do about thinking. `keep` leaves every declaration untouched. */
export type ThinkingMode = 'on' | 'off' | 'keep'

/**
 * What to do about the provider-level default level.
 *
 * `clear` exists because DSH's own models page has no field for
 * `providers.<route>.reasoning`: once this plugin writes it, nothing else in the
 * UI can take it back out.
 */
export type EffortChoice = ThinkingLevel | 'clear'

/** The values one click forces onto every in-scope model row. */
export interface BulkSpec {
  /** New input context window; `undefined` leaves each row's value alone. */
  readonly contextWindow?: number
  /** New output cap; `undefined` leaves each row's value alone. */
  readonly maxTokens?: number
  /** Image support to declare, or `keep`. */
  readonly image: ImageMode
  /** Whether to turn thinking on, off, or leave it alone; absent means leave it. */
  readonly thinking?: ThinkingMode
  /** The level a provider falls back to; `clear` removes it. */
  readonly defaultEffort?: EffortChoice
}

/** Why a plan refused to produce any writes. */
export type BulkProblem =
  | 'nothing'
  | 'bad-context'
  | 'bad-output'
  | 'bad-effort'
  | 'impossible'
  | 'no-providers'

/** One provider's replacement model array, and optionally its default level. */
export interface ProviderWrite {
  readonly provider: string
  readonly models: readonly unknown[]
  /** How many values in this provider actually differ. */
  readonly changed: number
  /** The new provider-level default level, when it changes. */
  readonly reasoning?: ThinkingLevel
  /** Whether the provider-level default level has to be removed. */
  readonly clearReasoning?: boolean
}

/** The outcome of planning, before anything is written. */
export interface BulkPlan {
  readonly writes: readonly ProviderWrite[]
  /** In-scope providers examined. */
  readonly providers: number
  /** In-scope model rows examined. */
  readonly models: number
  /** Values that would change: model fields plus provider defaults. */
  readonly changed: number
  /** Set when the plan cannot be carried out at all. */
  readonly problem?: BulkProblem
  /** Routes skipped because DSH's own adapters own them. */
  readonly skipped: readonly string[]
  /**
   * `provider/model` ids whose resulting window/output pair leaves DSH no room
   * to compact. Only populated with `problem === 'impossible'`.
   */
  readonly offenders: readonly string[]
}

/** Whether a value is a plain object rather than an array or null. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The model array of one provider entry.
 *
 * @param provider - the provider's value from the settings document.
 * @returns the array, or `undefined` when the entry carries none.
 */
export function modelRows(provider: unknown): readonly unknown[] | undefined {
  if (!isPlainObject(provider)) return undefined
  const models = provider.models
  return Array.isArray(models) ? models : undefined
}

/**
 * The token count at which DSH compacts, given a window and an output cap.
 *
 * @param contextWindow - the configured window.
 * @param maxTokens - the configured output cap.
 * @returns the trigger, which is non-positive when the pair is self-defeating.
 */
export function triggerOf(contextWindow: number, maxTokens: number): number {
  return Math.floor(
    Math.min(contextWindow * THRESHOLD_RATIO, contextWindow - maxTokens - HEADROOM_TOKENS),
  )
}

/**
 * Whether DSH can compact at all with this pair.
 *
 * @param contextWindow - the configured window.
 * @param maxTokens - the configured output cap.
 * @returns `true` when the trigger is positive.
 */
export function pairIsUsable(contextWindow: number, maxTokens: number): boolean {
  return triggerOf(contextWindow, maxTokens) > 0
}

/**
 * Group digits for a readout a person has to scan.
 *
 * @param value - a token count.
 * @returns e.g. `106,464`.
 */
export function formatTokens(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(value) || value.length !== expected.length) return false
  return expected.every((item, index) => value[index] === item)
}

function sameRecord(value: unknown, expected: Readonly<Record<string, unknown>>): boolean {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(expected)
  if (Object.keys(value).length !== keys.length) return false
  return keys.every((key) => value[key] === expected[key])
}

/**
 * The thinking declaration a row should carry once thinking is switched on.
 *
 * Existing levels are kept — a model already offering `medium` still offers it —
 * and only the baseline entries are repaired when a row declares them as `null`
 * or as an empty string, both of which DSH rejects or hides.
 *
 * @param existing - the row's current `reasoningEfforts`, of any shape.
 * @returns a declaration that offers at least `low`, `high` and `max`.
 */
function thinkingOn(existing: unknown): Record<string, unknown> {
  const next: Record<string, unknown> = { ...THINKING_BASELINE }
  if (isPlainObject(existing)) Object.assign(next, existing)

  for (const [level, wire] of Object.entries(next)) {
    if (level === 'off') continue
    // DSH rejects a declaration it cannot dispatch: a non-`off` level must carry
    // a non-empty wire string. Leaving one behind would fail the whole route's
    // resolution, which hides every model on that provider from every picker —
    // a far worse outcome than dropping a level nobody asked to keep.
    if (typeof wire === 'string' && wire.length > 0) continue
    const fallback = THINKING_BASELINE[level]
    if (fallback === undefined) delete next[level]
    else next[level] = fallback
  }
  return next
}

/**
 * Plan the whole click.
 *
 * @param providers - the `providers` record of the `llm-pi-ai` namespace.
 * @param spec - what the form asked for.
 * @returns the writes to issue, or the reason none can be.
 */
export function planBulk(providers: Record<string, unknown>, spec: BulkSpec): BulkPlan {
  const skipped: string[] = []
  const offenders: string[] = []
  const writes: ProviderWrite[] = []
  let providerCount = 0
  let modelCount = 0
  let changedTotal = 0

  const empty = (problem: BulkProblem, overrides: Partial<BulkPlan> = {}): BulkPlan => ({
    writes: [],
    providers: 0,
    models: 0,
    changed: 0,
    skipped,
    offenders,
    problem,
    ...overrides,
  })

  const thinking = spec.thinking ?? 'keep'
  const nothingRequested =
    spec.contextWindow === undefined &&
    spec.maxTokens === undefined &&
    spec.image === 'keep' &&
    thinking === 'keep' &&
    spec.defaultEffort === undefined
  if (nothingRequested) return empty('nothing')
  if (
    spec.contextWindow !== undefined &&
    (!Number.isInteger(spec.contextWindow) || spec.contextWindow <= 0)
  ) {
    return empty('bad-context')
  }
  if (
    spec.maxTokens !== undefined &&
    (!Number.isInteger(spec.maxTokens) || spec.maxTokens <= 0)
  ) {
    return empty('bad-output')
  }
  if (
    spec.defaultEffort !== undefined &&
    spec.defaultEffort !== 'clear' &&
    !(THINKING_LEVELS as readonly string[]).includes(spec.defaultEffort)
  ) {
    return empty('bad-effort')
  }

  const imageValue: readonly string[] | undefined =
    spec.image === 'keep' ? undefined : spec.image === 'support' ? ['text', 'image'] : ['text']

  // A default level is meaningless when every model is told it cannot think, so
  // it is dropped rather than written as dead configuration. Clearing is still
  // meaningful: it removes a value an earlier run left behind.
  const effort = thinking === 'off' && spec.defaultEffort !== 'clear' ? undefined : spec.defaultEffort

  for (const [provider, providerValue] of Object.entries(providers)) {
    if (ADAPTER_OWNED_ROUTES.has(provider)) {
      skipped.push(provider)
      continue
    }
    const rows = modelRows(providerValue)
    if (rows === undefined) continue
    providerCount += 1

    const providerRecord = isPlainObject(providerValue) ? providerValue : {}
    const fallbackWindow =
      typeof providerRecord.defaultContextWindow === 'number'
        ? providerRecord.defaultContextWindow
        : DEFAULT_CONTEXT_WINDOW
    const fallbackOutput =
      typeof providerRecord.defaultMaxTokens === 'number'
        ? providerRecord.defaultMaxTokens
        : DEFAULT_MAX_TOKENS
    // Only a write that touches capacity can introduce a bad pair. An untouched
    // row that is already broken must not block a fix elsewhere.
    const touchesCapacity = spec.contextWindow !== undefined || spec.maxTokens !== undefined

    let changedHere = 0
    const nextRows = rows.map((row) => {
      modelCount += 1
      if (!isPlainObject(row)) return row
      const next: Record<string, unknown> = { ...row }
      let touched = 0

      if (spec.contextWindow !== undefined && next.contextWindow !== spec.contextWindow) {
        next.contextWindow = spec.contextWindow
        touched += 1
      }
      if (spec.maxTokens !== undefined && next.maxTokens !== spec.maxTokens) {
        next.maxTokens = spec.maxTokens
        touched += 1
      }
      if (imageValue !== undefined && !sameStrings(next.input, imageValue)) {
        next.input = [...imageValue]
        touched += 1
      }

      if (thinking === 'on') {
        const declared = thinkingOn(next.reasoningEfforts)
        if (!sameRecord(next.reasoningEfforts, declared)) {
          next.reasoningEfforts = declared
          touched += 1
        }
      } else if (thinking === 'off' && next.reasoningEfforts !== false) {
        next.reasoningEfforts = false
        touched += 1
      }

      // Check the pair the row will actually hold afterwards, not just the pair
      // in the form. Setting only the output cap can starve an untouched window,
      // and setting only the window can starve an untouched cap — including the
      // cap DSH silently assumes when the row declares none. That failure is
      // silent: DSH throws on every step and compaction is simply gone.
      if (touchesCapacity) {
        const window = typeof next.contextWindow === 'number' ? next.contextWindow : fallbackWindow
        const output = typeof next.maxTokens === 'number' ? next.maxTokens : fallbackOutput
        if (!pairIsUsable(window, output)) {
          const id = typeof next.id === 'string' ? next.id : '(no id)'
          offenders.push(`${provider}/${id}`)
        }
      }

      if (touched === 0) return row
      changedHere += touched
      return next
    })

    let reasoning: ThinkingLevel | undefined
    let clearReasoning: boolean | undefined
    if (effort !== undefined && providerValue !== null && typeof providerValue === 'object') {
      const current = (providerValue as Record<string, unknown>).reasoning
      if (effort === 'clear') {
        if (current !== undefined) {
          clearReasoning = true
          changedHere += 1
        }
      } else if (current !== effort) {
        reasoning = effort
        changedHere += 1
      }
    }

    if (changedHere > 0) {
      writes.push({
        provider,
        models: nextRows,
        changed: changedHere,
        ...(reasoning === undefined ? {} : { reasoning }),
        ...(clearReasoning === undefined ? {} : { clearReasoning }),
      })
    }
    changedTotal += changedHere
  }

  if (offenders.length > 0) {
    return empty('impossible', {
      providers: providerCount,
      models: modelCount,
      offenders: [...offenders],
    })
  }
  if (providerCount === 0) {
    return empty('no-providers')
  }

  return {
    writes,
    providers: providerCount,
    models: modelCount,
    changed: changedTotal,
    skipped,
    offenders,
  }
}
