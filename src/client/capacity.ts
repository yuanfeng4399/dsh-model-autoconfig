/**
 * The capacity spelling the official Models page reads and writes.
 *
 * A capacity field on that page is a *text* input accepting `256K` / `1M`, not
 * a number, so anything this plugin puts there has to survive a round trip
 * through the same grammar. These two helpers mirror
 * `dsh-client-ui-settings-models`'s internal `parseCapacity` / `formatCapacity`
 * exactly — including the deliberate choice that `K` is 1000 and `M` is 1e6, so
 * `1M` is 1000K and a count is only abbreviated when it divides evenly.
 *
 * They are reimplemented rather than imported because that package publishes no
 * exports for them; the client bundle is self-registering and exposes only its
 * plugin entry points.
 *
 * @module
 */

/** Accepted spellings: a decimal count with an optional K/M suffix. */
const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/i

/** Decimal suffix scales, matching how model capacities are quoted. */
const CAPACITY_SCALE: Record<string, number> = { k: 1e3, m: 1e6 }

/**
 * Read a typed capacity.
 *
 * @param text - raw field text.
 * @returns the token count, `undefined` when blank (meaning "inherit"), or
 *   `NaN` when unreadable — the same three outcomes the official parser has.
 */
export function parseCapacity(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  const match = CAPACITY_PATTERN.exec(trimmed)
  if (match === null) return Number.NaN
  const suffix = match[2]?.toLowerCase()
  const scale = suffix === 'k' || suffix === 'm' ? CAPACITY_SCALE[suffix]! : 1
  const scaled = Number(match[1]) * scale
  const rounded = Math.round(scaled)
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled
}

/**
 * Spell a stored count back in the shortest form that survives
 * {@link parseCapacity}. Only exact multiples are abbreviated, so `300000`
 * becomes `300K` and `262144` stays written out.
 *
 * @param value - stored capacity.
 * @returns the field text.
 */
export function formatCapacity(value: number): string {
  if (!Number.isInteger(value) || value <= 0) return String(value)
  if (value % CAPACITY_SCALE.m! === 0) return `${String(value / CAPACITY_SCALE.m!)}M`
  if (value % CAPACITY_SCALE.k! === 0) return `${String(value / CAPACITY_SCALE.k!)}K`
  return String(value)
}
