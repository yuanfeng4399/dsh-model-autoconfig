/**
 * UI copy. Chinese and English are maintained side by side; the active locale
 * selects between them.
 *
 * @module
 */

export const NS = 'dsh-model-autoconfig'

/** The translation function shape every component here takes. */
export type Translate = (key: string, params?: Record<string, unknown>) => string

export const zh: Record<string, string> = {
  cardTitle: '统一模型规格',
  cardIntro: '一次写入所有外部 API 提供方的模型。官方 DeepSeek 不动。',
  fieldContext: '输入上下文',
  fieldOutput: '输出上限',
  fieldImage: '图片',
  fieldThinking: '思考模式',
  fieldEffort: '默认档位',
  imageSupport: '支持图片',
  imageText: '仅文本',
  imageKeep: '不修改',
  thinkingOn: '开启',
  thinkingOff: '关闭',
  thinkingKeep: '不修改',
  effortUnset: '不修改',
  effortClear: '清除',
  placeholderContext: '300K',
  placeholderOutput: '64K',
  apply: '一键应用',
  applying: '写入中…',
  scope: '{providers} 个提供方 · {models} 个模型',
  willChange: '{changed} 处会变化',
  nothing: '先填一个要改的值，或把图片 / 思考改成具体选项。',
  badContext: '输入上下文要是正整数，可写 300K、1M 或 300000。',
  badOutput: '输出上限要是正整数，可写 64K 或 65536。',
  badEffort: '默认档位取值无效。',
  impossible:
    '这套值会让 DSH 无法压缩：窗口必须大于「输出上限 + 65,536」，否则每一步都会报错、主动压缩永久失效。受影响的模型：{list}。',
  noProviders: '没有找到外部 API 提供方。先在「添加提供商」里建一个。',
  noSettings: '设置服务不可用，读不到也写不了。请刷新页面。',
  refused: '写入被拒绝：{message}',
  done: '已写入 {changed} 处改动，覆盖 {providers} 个提供方。',
  noChange: '这些值已经一致，没有需要写入的内容。',
  triggerNote: '压缩触发点 {trigger}（窗口的 {share}）＝ min(窗口 × 80%, 窗口 − 输出 − 65,536)。',
  thinkingNote: '开启会补齐 low / high / max；max 只有显式声明才会出现在选择器里。',
  effortNote: '切换模型时选择器默认用 {effort}。',
  effortClearNote: '删除各提供方的默认档位，回到 DSH 自己的回落。',
  effortOffNote: '思考关闭时默认档位不写入。',
  skippedNote: '已跳过 DSH 自带的 {list}。',
  persistNote: '删除插件后这些值保留，DSH 其余部分与原版一致。',
  readOnly: '当前设置不可写（只读或未连接）。',
}

export const en: Record<string, string> = {
  cardTitle: 'Unified model specs',
  cardIntro: 'Write every external API provider model at once. DSH’s own DeepSeek routes are never touched.',
  fieldContext: 'Input context',
  fieldOutput: 'Output cap',
  fieldImage: 'Images',
  fieldThinking: 'Thinking',
  fieldEffort: 'Default level',
  imageSupport: 'Supports images',
  imageText: 'Text only',
  imageKeep: 'Leave alone',
  thinkingOn: 'On',
  thinkingOff: 'Off',
  thinkingKeep: 'Leave alone',
  effortUnset: 'Leave alone',
  effortClear: 'Clear',
  placeholderContext: '300K',
  placeholderOutput: '64K',
  apply: 'Apply to all',
  applying: 'Writing…',
  scope: '{providers} provider(s) · {models} model(s)',
  willChange: '{changed} field(s) would change',
  nothing: 'Fill in one value, or pick a concrete image / thinking choice.',
  badContext: 'Input context must be a positive integer, e.g. 300K, 1M or 300000.',
  badOutput: 'Output cap must be a positive integer, e.g. 64K or 65536.',
  badEffort: 'That default level is not a valid value.',
  impossible:
    'This pair leaves DSH no room to compact: the window must exceed output cap + 65,536, or every step throws and proactive compaction is gone. Affected models: {list}.',
  noProviders: 'No external API providers found. Add one under “Add provider” first.',
  noSettings: 'The settings service is unreachable. Refresh the page.',
  refused: 'The settings write was refused: {message}',
  done: 'Wrote {changed} field(s) across {providers} provider(s).',
  noChange: 'These values already match; nothing to write.',
  triggerNote: 'Compaction triggers at {trigger} ({share} of the window) = min(window × 80%, window − output − 65,536).',
  thinkingNote: 'On fills in low / high / max; max only appears in the picker when declared explicitly.',
  effortNote: 'Switching models falls back to {effort}.',
  effortClearNote: 'Removes each provider’s default level, restoring DSH’s own fallback.',
  effortOffNote: 'The default level is not written while thinking is off.',
  skippedNote: 'Skipped DSH’s own {list}.',
  persistNote: 'These values survive deleting the plugin; the rest of DSH is unchanged.',
  readOnly: 'Settings are read-only here, so nothing can be written.',
}

/** Substitute `{name}` placeholders. */
export function format(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in params ? String(params[key]) : `{${key}}`,
  )
}
