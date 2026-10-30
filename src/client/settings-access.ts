/**
 * Reads and writes against DSH's settings plane.
 *
 * Two different services are involved, and conflating them is the mistake this
 * module exists to prevent:
 *
 * - **Reads** come from the shared describe mirror (`configForms.describe()`),
 *   which is a synchronous snapshot of the last answer the settings UI
 *   received. Using it means this plugin issues no wire reads of its own.
 * - **Writes** go through `remote.settings.mutate`, which is asynchronous and
 *   reports failure in an **envelope** (`{ok:false, error:{code, message}}`)
 *   rather than by throwing. A concurrency rejection in particular arrives as a
 *   successful call carrying `code: "settings/conflict"`.
 *
 * The mirror is preferred but not required: `configForms` is an undocumented
 * service, so a fallback path reads the same document straight from the Remote.
 * A plugin that silently stops working when an undocumented dependency moves is
 * worse than one that reads for itself.
 *
 * @module
 */

/** One namespace's view as the describe mirror publishes it. */
export interface SettingsNamespaceView {
  readonly ns: string
  readonly revision?: number
  readonly user?: unknown
  readonly value?: unknown
  readonly writable?: boolean
}

/** The whole-document view a describe answers with. */
export interface SettingsView {
  readonly writable?: boolean
  readonly hasDocument?: boolean
  readonly namespaces?: readonly SettingsNamespaceView[]
}

/** The describe mirror's snapshot. */
export interface SettingsSnapshot {
  readonly status?: string
  readonly view?: SettingsView
  readonly error?: string | null
}

/** The describe face over the shared mirror. */
export interface DescribeFace {
  ensure(): void
  getSnapshot(): SettingsSnapshot
}

/** The enveloped result every Remote call returns. */
export type RemoteEnvelope<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly error: { readonly code?: string; readonly message?: string }
    }

/** One settings path operation. */
export interface SettingsOp {
  readonly op: 'set' | 'unset'
  readonly path: readonly string[]
  readonly value?: unknown
}

/** What this module needs from `remote.settings`. */
export interface SettingsRemote {
  describe?(): Promise<RemoteEnvelope<SettingsView>>
  mutate(
    ns: string,
    ops: readonly SettingsOp[],
    expectedRevision?: number,
  ): Promise<RemoteEnvelope<unknown>>
}

/** How many times a conflicting write is retried before giving up. */
export const WRITE_ATTEMPTS = 3

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether an envelope reports the settings optimistic-concurrency rejection.
 * The code is the Remote's kebab-case spelling, not a class name.
 */
export function isConflict(envelope: {
  readonly error?: { readonly code?: string }
}): boolean {
  return envelope.error?.code === 'settings/conflict'
}

/**
 * Whether a config path this plugin may write. `llm-pi-ai` declares `providers`
 * volatile, so every model field beneath it is writable.
 */
export function writablePath(path: readonly string[]): boolean {
  return path[0] === 'providers'
}

/** The settings accessor one plugin instance uses. */
export interface SettingsAccess {
  /** The pi-ai namespace's view, or `undefined` before an answer is held. */
  namespaceView(): SettingsNamespaceView | undefined
  /** The revision the next write must be fenced against. */
  revisionOf(): number | undefined
  /** The user layer's providers, when the document holds any. */
  readProviders(): Record<string, unknown> | undefined
  /** Pull one answer through the fallback path, when it is in use. */
  refresh(): Promise<void>
  /** Write one provider's model array, retrying a conflict. */
  writeModels(provider: string, models: readonly unknown[]): Promise<void>
  /**
   * Write several paths as one batch.
   *
   * The Remote commits a mutate call as one revision bump, so a batch either
   * lands whole or not at all — which is why the plugin sends every provider in
   * a single call instead of looping.
   */
  writeOps(ops: readonly SettingsOp[]): Promise<void>
  /** Write an arbitrary volatile path, for callers that need one. */
  writePath(path: readonly string[], value: unknown): Promise<void>
}

/**
 * Build the settings accessor.
 *
 * @param mirror - the describe face, when `configForms` is available.
 * @param remote - the settings Remote, when it is available.
 * @param namespace - the settings namespace to address.
 * @param onMissing - message for the "no settings service" error.
 * @param onRefused - fallback message for a refusal with no Host text.
 * @returns the accessor.
 */
export function createSettingsAccess(
  mirror: DescribeFace | undefined,
  remote: SettingsRemote | undefined,
  namespace: string,
  onMissing = 'the settings service is unavailable',
  onRefused = 'the settings write was refused',
): SettingsAccess {
  let fallbackView: SettingsView | undefined

  const fromMirror = (): SettingsNamespaceView | undefined => {
    if (mirror === undefined) return undefined
    try {
      mirror.ensure()
      const view = mirror.getSnapshot().view
      return view?.namespaces?.find((row) => row.ns === namespace)
    } catch {
      // A mirror that refuses to start is simply "no answer from it".
      return undefined
    }
  }

  const refresh = async (): Promise<void> => {
    const describe = remote?.describe
    if (mirror !== undefined || describe === undefined) return
    try {
      const response = await describe.call(remote)
      if (response.ok) fallbackView = response.value
    } catch {
      // Keep the last good answer.
    }
  }

  const namespaceView = (): SettingsNamespaceView | undefined =>
    fromMirror() ?? fallbackView?.namespaces?.find((row) => row.ns === namespace)

  const writeOps = async (ops: readonly SettingsOp[]): Promise<void> => {
    if (remote === undefined) throw new Error(onMissing)
    if (ops.length === 0) return
    for (const op of ops) {
      if (!writablePath(op.path)) {
        throw new Error(`refusing to write non-volatile path ${op.path.join('.')}`)
      }
    }
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
      // Re-read the fence before a retry: a conflict means someone else wrote,
      // so repeating the stale revision would simply conflict again.
      if (attempt > 0) await refresh()
      const response = await remote.mutate(namespace, ops, namespaceView()?.revision)
      if (response.ok) {
        await refresh()
        return
      }
      if (isConflict(response) && attempt < WRITE_ATTEMPTS - 1) continue
      throw new Error(response.error?.message ?? onRefused)
    }
  }

  const writePath = (path: readonly string[], value: unknown): Promise<void> =>
    writeOps([{ op: 'set', path, value }])

  return {
    namespaceView,
    revisionOf: () => namespaceView()?.revision,
    readProviders: () => {
      const user = namespaceView()?.user
      if (!isPlainObject(user)) return undefined
      const providers = user.providers
      return isPlainObject(providers) ? providers : undefined
    },
    refresh,
    writeModels: (provider, models) => writePath(['providers', provider, 'models'], models),
    writeOps,
    writePath,
  }
}
