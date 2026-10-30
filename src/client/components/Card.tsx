/**
 * The plugin's only UI: one card in the Models page footer.
 *
 * Five compact controls and a button. There is no catalog, no probing, no
 * auto-run and no per-provider control — the card exists so a person can type a
 * spec once and have every external provider adopt it.
 *
 * @module
 */

import { useCallback, useState, type CSSProperties, type ReactElement } from 'react'
import { parseCapacity } from '../capacity.js'
import {
  formatTokens,
  triggerOf,
  type BulkProblem,
  type BulkSpec,
  type EffortChoice,
  type ImageMode,
  type ThinkingLevel,
  type ThinkingMode,
} from '../model-fields.js'
import { format, type Translate } from '../locales.js'

/** What the card needs from the plugin root. */
export interface CardController {
  /** Examine the current settings for this spec without writing anything. */
  preview(spec: BulkSpec): ScopePreview
  /** Write the spec, returning what actually changed. */
  apply(spec: BulkSpec): Promise<ApplyOutcome>
}

/** A dry run of one spec against the live settings document. */
export interface ScopePreview {
  readonly providers: number
  readonly models: number
  readonly changed: number
  readonly skipped: readonly string[]
  /** `provider/model` rows whose resulting pair would break compaction. */
  readonly offenders: readonly string[]
  /** True when no settings answer is held yet. */
  readonly missing: boolean
  readonly writable: boolean
  readonly problem?: BulkProblem
}

/** The result of a write. */
export type ApplyOutcome =
  | { readonly ok: true; readonly changed: number; readonly providers: number }
  | { readonly ok: false; readonly reason: 'refused' | 'no-settings'; readonly message?: string }

export interface CardProps {
  readonly controller: CardController
  readonly t: Translate
}

const panel: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.25))',
  borderRadius: 'var(--dsw-radius-md, 10px)',
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-primary, inherit)',
  /**
   * The models page offers no top-of-page slot, only `settings.models.footer`.
   * That slot's anchor renders with `display: contents`, so this card is a real
   * child of the page's column container — which makes `order` the supported way
   * to put it first without touching anyone else's DOM.
   */
  order: -1,
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  flexWrap: 'wrap',
}
const titleStyle: CSSProperties = { fontWeight: 600, fontSize: 13 }
const muted: CSSProperties = { color: 'var(--dsw-alias-label-secondary, inherit)', fontSize: 11.5 }
const danger: CSSProperties = {
  color: 'var(--dsw-alias-state-error-primary, #d9534f)',
  fontSize: 11.5,
}
const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: 8,
  flexWrap: 'wrap',
}
const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 11,
  color: 'var(--dsw-alias-label-secondary, inherit)',
}

/**
 * Input and select chrome, copied from DSH's own models page.
 *
 * The opaque `--dsw-alias-bg-layer-1` background is not decoration: a native
 * `<select>` popup paints itself from the select's own background and text
 * colours, so a transparent background leaves the list rendering light text on
 * its default white canvas — invisible until the pointer happens to land on a
 * row. `Canvas`/`CanvasText` are the fallbacks because they follow the OS colour
 * scheme when a theme token is missing.
 */
const inputStyle: CSSProperties = {
  boxSizing: 'border-box',
  height: 28,
  border: '1px solid var(--dsw-alias-border-l4, rgba(127,127,127,0.35))',
  borderRadius: 'var(--dsw-radius-md, 6px)',
  background: 'var(--dsw-alias-bg-layer-1, Canvas)',
  color: 'var(--dsw-alias-label-primary, CanvasText)',
  font: 'inherit',
  fontSize: 12,
  padding: '0 8px',
  width: 84,
}
const selectStyle: CSSProperties = { ...inputStyle, width: 'auto', paddingRight: 6, cursor: 'pointer' }
/** Options carry the same pair, so the popup rows never depend on inheritance. */
const optionStyle: CSSProperties = {
  background: 'var(--dsw-alias-bg-layer-1, Canvas)',
  color: 'var(--dsw-alias-label-primary, CanvasText)',
}
const buttonStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
  borderRadius: 'var(--dsw-radius-md, 6px)',
  padding: '4px 12px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  background: 'var(--dsw-alias-bg-layer-1, Canvas)',
  color: 'var(--dsw-alias-label-primary, CanvasText)',
  marginLeft: 'auto',
}
const buttonOff: CSSProperties = { ...buttonStyle, opacity: 0.5, cursor: 'not-allowed' }

const IMAGE_MODES: readonly ImageMode[] = ['keep', 'support', 'text']
const THINKING_MODES: readonly ThinkingMode[] = ['on', 'off', 'keep']
/** The levels this plugin always declares, so a default here always applies. */
const EFFORT_CHOICES: readonly ThinkingLevel[] = ['low', 'high', 'max']

function imageLabel(t: Translate, mode: ImageMode): string {
  if (mode === 'support') return t('imageSupport')
  if (mode === 'text') return t('imageText')
  return t('imageKeep')
}

function thinkingLabel(t: Translate, mode: ThinkingMode): string {
  if (mode === 'on') return t('thinkingOn')
  if (mode === 'off') return t('thinkingOff')
  return t('thinkingKeep')
}

/**
 * Turn the form into a spec.
 *
 * @param contextText - raw context field.
 * @param outputText - raw output field.
 * @param image - image choice.
 * @param thinking - thinking choice.
 * @param effort - default level, or the empty string for "not set".
 * @returns the spec, plus which field was unreadable when one was.
 */
function readSpec(
  contextText: string,
  outputText: string,
  image: ImageMode,
  thinking: ThinkingMode,
  effort: string,
): { spec: BulkSpec; badField?: 'context' | 'output' } {
  const level: EffortChoice | undefined =
    effort === 'clear' ? 'clear' : EFFORT_CHOICES.find((choice) => choice === effort)
  const rest = {
    image,
    thinking,
    ...(level === undefined ? {} : { defaultEffort: level }),
  }
  const contextWindow = parseCapacity(contextText)
  if (typeof contextWindow === 'number' && Number.isNaN(contextWindow)) {
    return { spec: rest, badField: 'context' }
  }
  const maxTokens = parseCapacity(outputText)
  if (typeof maxTokens === 'number' && Number.isNaN(maxTokens)) {
    return { spec: rest, badField: 'output' }
  }
  return {
    spec: {
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
      ...rest,
    },
  }
}

function problemText(t: Translate, problem: BulkProblem, preview: ScopePreview): string {
  switch (problem) {
    case 'bad-context':
      return t('badContext')
    case 'bad-output':
      return t('badOutput')
    case 'bad-effort':
      return t('badEffort')
    case 'no-providers':
      return t('noProviders')
    case 'impossible':
      return format(t('impossible'), {
        list: preview.offenders.length > 0 ? preview.offenders.join('、') : '—',
      })
    case 'nothing':
      return t('nothing')
  }
}

/**
 * The card.
 *
 * @param props - the controller and the active translation function.
 * @returns the rendered card.
 */
export function AutoConfigCard({ controller, t }: CardProps): ReactElement {
  const [contextText, setContextText] = useState('')
  const [outputText, setOutputText] = useState('')
  const [image, setImage] = useState<ImageMode>('keep')
  const [thinking, setThinking] = useState<ThinkingMode>('on')
  const [effort, setEffort] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState(false)

  const { spec, badField } = readSpec(contextText, outputText, image, thinking, effort)
  const preview = controller.preview(spec)
  const blocked = badField !== undefined || preview.missing || !preview.writable
  const canApply = !busy && !blocked && preview.changed > 0

  const run = useCallback(async (): Promise<void> => {
    setBusy(true)
    setFailed(false)
    setNote(undefined)
    try {
      const outcome = await controller.apply(spec)
      if (outcome.ok) {
        setNote(
          outcome.changed > 0
            ? format(t('done'), { changed: outcome.changed, providers: outcome.providers })
            : t('noChange'),
        )
      } else {
        setFailed(true)
        setNote(
          outcome.reason === 'no-settings'
            ? t('noSettings')
            : format(t('refused'), { message: outcome.message ?? '' }),
        )
      }
    } catch (error) {
      setFailed(true)
      setNote(format(t('refused'), { message: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusy(false)
    }
  }, [controller, spec, t])

  const trigger =
    spec.contextWindow !== undefined && spec.maxTokens !== undefined
      ? triggerOf(spec.contextWindow, spec.maxTokens)
      : undefined

  const hints: string[] = []
  if (thinking === 'on') hints.push(t('thinkingNote'))
  if (effort === 'clear') hints.push(t('effortClearNote'))
  else if (effort !== '') hints.push(format(t('effortNote'), { effort }))
  if (thinking === 'off' && effort !== '' && effort !== 'clear') hints.push(t('effortOffNote'))

  return (
    <section style={panel}>
      <div style={headerStyle}>
        <span style={titleStyle}>{t('cardTitle')}</span>
        <span style={muted}>{t('cardIntro')}</span>
      </div>

      <div style={rowStyle}>
        <label style={fieldStyle}>
          {t('fieldContext')}
          <input
            style={inputStyle}
            value={contextText}
            placeholder={t('placeholderContext')}
            onChange={(event) => setContextText(event.target.value)}
          />
        </label>
        <label style={fieldStyle}>
          {t('fieldOutput')}
          <input
            style={inputStyle}
            value={outputText}
            placeholder={t('placeholderOutput')}
            onChange={(event) => setOutputText(event.target.value)}
          />
        </label>
        <label style={fieldStyle}>
          {t('fieldImage')}
          <select
            style={selectStyle}
            value={image}
            onChange={(event) => setImage(event.target.value as ImageMode)}
          >
            {IMAGE_MODES.map((mode) => (
              <option key={mode} value={mode} style={optionStyle}>
                {imageLabel(t, mode)}
              </option>
            ))}
          </select>
        </label>
        <label style={fieldStyle}>
          {t('fieldThinking')}
          <select
            style={selectStyle}
            value={thinking}
            onChange={(event) => setThinking(event.target.value as ThinkingMode)}
          >
            {THINKING_MODES.map((mode) => (
              <option key={mode} value={mode} style={optionStyle}>
                {thinkingLabel(t, mode)}
              </option>
            ))}
          </select>
        </label>
        <label style={fieldStyle}>
          {t('fieldEffort')}
          <select
            style={selectStyle}
            value={effort}
            onChange={(event) => setEffort(event.target.value)}
          >
            <option value="" style={optionStyle}>
              {t('effortUnset')}
            </option>
            <option value="clear" style={optionStyle}>
              {t('effortClear')}
            </option>
            {EFFORT_CHOICES.map((choice) => (
              <option key={choice} value={choice} style={optionStyle}>
                {choice}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          style={canApply ? buttonStyle : buttonOff}
          disabled={!canApply}
          onClick={() => {
            void run()
          }}
        >
          {busy ? t('applying') : t('apply')}
        </button>
      </div>

      <div style={rowStyle}>
        {preview.missing ? (
          <span style={danger}>{t('noSettings')}</span>
        ) : preview.problem === 'nothing' ? (
          <span style={muted}>{t('nothing')}</span>
        ) : preview.problem !== undefined ? (
          <span style={danger}>{problemText(t, preview.problem, preview)}</span>
        ) : (
          <>
            <span style={muted}>
              {format(t('scope'), { providers: preview.providers, models: preview.models })}
              {' · '}
              {format(t('willChange'), { changed: preview.changed })}
            </span>
            {trigger !== undefined && trigger > 0 ? (
              <span style={muted}>
                {format(t('triggerNote'), {
                  trigger: formatTokens(trigger),
                  share: `${String(Math.round((trigger / (spec.contextWindow ?? 1)) * 100))}%`,
                })}
              </span>
            ) : null}
            {preview.skipped.length > 0 ? (
              <span style={muted}>
                {format(t('skippedNote'), { list: preview.skipped.join('、') })}
              </span>
            ) : null}
          </>
        )}
      </div>

      {badField !== undefined ? (
        <div style={danger}>{badField === 'context' ? t('badContext') : t('badOutput')}</div>
      ) : null}
      {!preview.writable && !preview.missing ? <div style={muted}>{t('readOnly')}</div> : null}
      {note !== undefined ? (
        <div style={failed ? danger : muted} role="status">
          {note}
        </div>
      ) : null}
      {hints.length > 0 ? <div style={muted}>{hints.join(' · ')}</div> : null}
      <div style={muted}>{t('persistNote')}</div>
    </section>
  )
}
