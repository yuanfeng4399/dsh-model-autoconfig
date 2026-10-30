window.__ModuleLoader__.load({ id: 'dsh-model-autoconfig', factory: (require) => { var module = { exports: {} }; var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let react = require("react");
let react_jsx_runtime = require("react/jsx-runtime");
//#region src/client/locales.ts
/**
* UI copy. Chinese and English are maintained side by side; the active locale
* selects between them.
*
* @module
*/
const NS = "dsh-model-autoconfig";
const zh = {
	cardTitle: "统一模型规格",
	cardIntro: "一次写入所有外部 API 提供方的模型。官方 DeepSeek 不动。",
	fieldContext: "输入上下文",
	fieldOutput: "输出上限",
	fieldImage: "图片",
	fieldThinking: "思考模式",
	fieldEffort: "默认档位",
	imageSupport: "支持图片",
	imageText: "仅文本",
	imageKeep: "不修改",
	thinkingOn: "开启",
	thinkingOff: "关闭",
	thinkingKeep: "不修改",
	effortUnset: "不修改",
	effortClear: "清除",
	placeholderContext: "300K",
	placeholderOutput: "64K",
	apply: "一键应用",
	applying: "写入中…",
	scope: "{providers} 个提供方 · {models} 个模型",
	willChange: "{changed} 处会变化",
	nothing: "先填一个要改的值，或把图片 / 思考改成具体选项。",
	badContext: "输入上下文要是正整数，可写 300K、1M 或 300000。",
	badOutput: "输出上限要是正整数，可写 64K 或 65536。",
	badEffort: "默认档位取值无效。",
	impossible: "这套值会让 DSH 无法压缩：窗口必须大于「输出上限 + 65,536」，否则每一步都会报错、主动压缩永久失效。受影响的模型：{list}。",
	noProviders: "没有找到外部 API 提供方。先在「添加提供商」里建一个。",
	noSettings: "设置服务不可用，读不到也写不了。请刷新页面。",
	refused: "写入被拒绝：{message}",
	done: "已写入 {changed} 处改动，覆盖 {providers} 个提供方。",
	noChange: "这些值已经一致，没有需要写入的内容。",
	triggerNote: "压缩触发点 {trigger}（窗口的 {share}）＝ min(窗口 × 80%, 窗口 − 输出 − 65,536)。",
	thinkingNote: "开启会补齐 low / high / max；max 只有显式声明才会出现在选择器里。",
	effortNote: "切换模型时选择器默认用 {effort}。",
	effortClearNote: "删除各提供方的默认档位，回到 DSH 自己的回落。",
	effortOffNote: "思考关闭时默认档位不写入。",
	skippedNote: "已跳过 DSH 自带的 {list}。",
	persistNote: "删除插件后这些值保留，DSH 其余部分与原版一致。",
	readOnly: "当前设置不可写（只读或未连接）。"
};
const en = {
	cardTitle: "Unified model specs",
	cardIntro: "Write every external API provider model at once. DSH’s own DeepSeek routes are never touched.",
	fieldContext: "Input context",
	fieldOutput: "Output cap",
	fieldImage: "Images",
	fieldThinking: "Thinking",
	fieldEffort: "Default level",
	imageSupport: "Supports images",
	imageText: "Text only",
	imageKeep: "Leave alone",
	thinkingOn: "On",
	thinkingOff: "Off",
	thinkingKeep: "Leave alone",
	effortUnset: "Leave alone",
	effortClear: "Clear",
	placeholderContext: "300K",
	placeholderOutput: "64K",
	apply: "Apply to all",
	applying: "Writing…",
	scope: "{providers} provider(s) · {models} model(s)",
	willChange: "{changed} field(s) would change",
	nothing: "Fill in one value, or pick a concrete image / thinking choice.",
	badContext: "Input context must be a positive integer, e.g. 300K, 1M or 300000.",
	badOutput: "Output cap must be a positive integer, e.g. 64K or 65536.",
	badEffort: "That default level is not a valid value.",
	impossible: "This pair leaves DSH no room to compact: the window must exceed output cap + 65,536, or every step throws and proactive compaction is gone. Affected models: {list}.",
	noProviders: "No external API providers found. Add one under “Add provider” first.",
	noSettings: "The settings service is unreachable. Refresh the page.",
	refused: "The settings write was refused: {message}",
	done: "Wrote {changed} field(s) across {providers} provider(s).",
	noChange: "These values already match; nothing to write.",
	triggerNote: "Compaction triggers at {trigger} ({share} of the window) = min(window × 80%, window − output − 65,536).",
	thinkingNote: "On fills in low / high / max; max only appears in the picker when declared explicitly.",
	effortNote: "Switching models falls back to {effort}.",
	effortClearNote: "Removes each provider’s default level, restoring DSH’s own fallback.",
	effortOffNote: "The default level is not written while thinking is off.",
	skippedNote: "Skipped DSH’s own {list}.",
	persistNote: "These values survive deleting the plugin; the rest of DSH is unchanged.",
	readOnly: "Settings are read-only here, so nothing can be written."
};
/** Substitute `{name}` placeholders. */
function format(template, params) {
	return template.replace(/\{(\w+)\}/g, (_, key) => key in params ? String(params[key]) : `{${key}}`);
}
//#endregion
//#region src/client/model-fields.ts
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
const ADAPTER_OWNED_ROUTES = /* @__PURE__ */ new Set(["deepseek-account", "deepseek-official"]);
/**
* Tokens DSH reserves on top of the output cap before compaction may run.
*
* Mirrors `compaction-basic`'s default `headroomTokens`. It is only used for the
* read-only trigger readout and for catching a self-defeating pair; nothing here
* writes it anywhere.
*/
const HEADROOM_TOKENS = 65536;
/** `compaction-basic`'s default threshold ratio. */
const THRESHOLD_RATIO = .8;
/**
* The output cap DSH assumes for a model that declares none.
*
* Mirrors `DEFAULT_MAX_TOKENS` in `dsh-llm-pi-ai`. It matters for the safety
* check: a row with no explicit cap is not "no cap", it is 32,768.
*/
const DEFAULT_MAX_TOKENS = 32768;
/** The window DSH assumes for a model that declares none. */
const DEFAULT_CONTEXT_WINDOW = 262144;
/**
* Every thinking level DSH accepts, in its own escalation order.
*
* Mirrors `THINKING_LEVELS` in `dsh-llm-pi-ai`. Only `off` may carry an empty
* wire value; every other level needs the string the provider is sent.
*/
const THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
/**
* The levels written when thinking is switched on.
*
* These are the three a DeepSeek-style relay is known to accept, and `max` is
* the point of the exercise: DSH only offers `xhigh` and `max` when a model
* declares them explicitly, so a model without `max` in `reasoningEfforts` can
* never be asked for it.
*/
const THINKING_BASELINE = {
	low: "low",
	high: "high",
	max: "max"
};
/** Whether a value is a plain object rather than an array or null. */
function isPlainObject$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* The model array of one provider entry.
*
* @param provider - the provider's value from the settings document.
* @returns the array, or `undefined` when the entry carries none.
*/
function modelRows(provider) {
	if (!isPlainObject$1(provider)) return void 0;
	const models = provider.models;
	return Array.isArray(models) ? models : void 0;
}
/**
* The token count at which DSH compacts, given a window and an output cap.
*
* @param contextWindow - the configured window.
* @param maxTokens - the configured output cap.
* @returns the trigger, which is non-positive when the pair is self-defeating.
*/
function triggerOf(contextWindow, maxTokens) {
	return Math.floor(Math.min(contextWindow * THRESHOLD_RATIO, contextWindow - maxTokens - HEADROOM_TOKENS));
}
/**
* Whether DSH can compact at all with this pair.
*
* @param contextWindow - the configured window.
* @param maxTokens - the configured output cap.
* @returns `true` when the trigger is positive.
*/
function pairIsUsable(contextWindow, maxTokens) {
	return triggerOf(contextWindow, maxTokens) > 0;
}
/**
* Group digits for a readout a person has to scan.
*
* @param value - a token count.
* @returns e.g. `106,464`.
*/
function formatTokens(value) {
	return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function sameStrings(value, expected) {
	if (!Array.isArray(value) || value.length !== expected.length) return false;
	return expected.every((item, index) => value[index] === item);
}
function sameRecord(value, expected) {
	if (!isPlainObject$1(value)) return false;
	const keys = Object.keys(expected);
	if (Object.keys(value).length !== keys.length) return false;
	return keys.every((key) => value[key] === expected[key]);
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
function thinkingOn(existing) {
	const next = { ...THINKING_BASELINE };
	if (isPlainObject$1(existing)) Object.assign(next, existing);
	for (const [level, wire] of Object.entries(next)) {
		if (level === "off") continue;
		if (typeof wire === "string" && wire.length > 0) continue;
		const fallback = THINKING_BASELINE[level];
		if (fallback === void 0) delete next[level];
		else next[level] = fallback;
	}
	return next;
}
/**
* Plan the whole click.
*
* @param providers - the `providers` record of the `llm-pi-ai` namespace.
* @param spec - what the form asked for.
* @returns the writes to issue, or the reason none can be.
*/
function planBulk(providers, spec) {
	const skipped = [];
	const offenders = [];
	const writes = [];
	let providerCount = 0;
	let modelCount = 0;
	let changedTotal = 0;
	const empty = (problem, overrides = {}) => ({
		writes: [],
		providers: 0,
		models: 0,
		changed: 0,
		skipped,
		offenders,
		problem,
		...overrides
	});
	const thinking = spec.thinking ?? "keep";
	if (spec.contextWindow === void 0 && spec.maxTokens === void 0 && spec.image === "keep" && thinking === "keep" && spec.defaultEffort === void 0) return empty("nothing");
	if (spec.contextWindow !== void 0 && (!Number.isInteger(spec.contextWindow) || spec.contextWindow <= 0)) return empty("bad-context");
	if (spec.maxTokens !== void 0 && (!Number.isInteger(spec.maxTokens) || spec.maxTokens <= 0)) return empty("bad-output");
	if (spec.defaultEffort !== void 0 && spec.defaultEffort !== "clear" && !THINKING_LEVELS.includes(spec.defaultEffort)) return empty("bad-effort");
	const imageValue = spec.image === "keep" ? void 0 : spec.image === "support" ? ["text", "image"] : ["text"];
	const effort = thinking === "off" && spec.defaultEffort !== "clear" ? void 0 : spec.defaultEffort;
	for (const [provider, providerValue] of Object.entries(providers)) {
		if (ADAPTER_OWNED_ROUTES.has(provider)) {
			skipped.push(provider);
			continue;
		}
		const rows = modelRows(providerValue);
		if (rows === void 0) continue;
		providerCount += 1;
		const providerRecord = isPlainObject$1(providerValue) ? providerValue : {};
		const fallbackWindow = typeof providerRecord.defaultContextWindow === "number" ? providerRecord.defaultContextWindow : DEFAULT_CONTEXT_WINDOW;
		const fallbackOutput = typeof providerRecord.defaultMaxTokens === "number" ? providerRecord.defaultMaxTokens : DEFAULT_MAX_TOKENS;
		const touchesCapacity = spec.contextWindow !== void 0 || spec.maxTokens !== void 0;
		let changedHere = 0;
		const nextRows = rows.map((row) => {
			modelCount += 1;
			if (!isPlainObject$1(row)) return row;
			const next = { ...row };
			let touched = 0;
			if (spec.contextWindow !== void 0 && next.contextWindow !== spec.contextWindow) {
				next.contextWindow = spec.contextWindow;
				touched += 1;
			}
			if (spec.maxTokens !== void 0 && next.maxTokens !== spec.maxTokens) {
				next.maxTokens = spec.maxTokens;
				touched += 1;
			}
			if (imageValue !== void 0 && !sameStrings(next.input, imageValue)) {
				next.input = [...imageValue];
				touched += 1;
			}
			if (thinking === "on") {
				const declared = thinkingOn(next.reasoningEfforts);
				if (!sameRecord(next.reasoningEfforts, declared)) {
					next.reasoningEfforts = declared;
					touched += 1;
				}
			} else if (thinking === "off" && next.reasoningEfforts !== false) {
				next.reasoningEfforts = false;
				touched += 1;
			}
			if (touchesCapacity) {
				if (!pairIsUsable(typeof next.contextWindow === "number" ? next.contextWindow : fallbackWindow, typeof next.maxTokens === "number" ? next.maxTokens : fallbackOutput)) {
					const id = typeof next.id === "string" ? next.id : "(no id)";
					offenders.push(`${provider}/${id}`);
				}
			}
			if (touched === 0) return row;
			changedHere += touched;
			return next;
		});
		let reasoning;
		let clearReasoning;
		if (effort !== void 0 && providerValue !== null && typeof providerValue === "object") {
			const current = providerValue.reasoning;
			if (effort === "clear") {
				if (current !== void 0) {
					clearReasoning = true;
					changedHere += 1;
				}
			} else if (current !== effort) {
				reasoning = effort;
				changedHere += 1;
			}
		}
		if (changedHere > 0) writes.push({
			provider,
			models: nextRows,
			changed: changedHere,
			...reasoning === void 0 ? {} : { reasoning },
			...clearReasoning === void 0 ? {} : { clearReasoning }
		});
		changedTotal += changedHere;
	}
	if (offenders.length > 0) return empty("impossible", {
		providers: providerCount,
		models: modelCount,
		offenders: [...offenders]
	});
	if (providerCount === 0) return empty("no-providers");
	return {
		writes,
		providers: providerCount,
		models: modelCount,
		changed: changedTotal,
		skipped,
		offenders
	};
}
function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Whether an envelope reports the settings optimistic-concurrency rejection.
* The code is the Remote's kebab-case spelling, not a class name.
*/
function isConflict(envelope) {
	return envelope.error?.code === "settings/conflict";
}
/**
* Whether a config path this plugin may write. `llm-pi-ai` declares `providers`
* volatile, so every model field beneath it is writable.
*/
function writablePath(path) {
	return path[0] === "providers";
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
function createSettingsAccess(mirror, remote, namespace, onMissing = "the settings service is unavailable", onRefused = "the settings write was refused") {
	let fallbackView;
	const fromMirror = () => {
		if (mirror === void 0) return void 0;
		try {
			mirror.ensure();
			return mirror.getSnapshot().view?.namespaces?.find((row) => row.ns === namespace);
		} catch {
			return;
		}
	};
	const refresh = async () => {
		const describe = remote?.describe;
		if (mirror !== void 0 || describe === void 0) return;
		try {
			const response = await describe.call(remote);
			if (response.ok) fallbackView = response.value;
		} catch {}
	};
	const namespaceView = () => fromMirror() ?? fallbackView?.namespaces?.find((row) => row.ns === namespace);
	const writeOps = async (ops) => {
		if (remote === void 0) throw new Error(onMissing);
		if (ops.length === 0) return;
		for (const op of ops) if (!writablePath(op.path)) throw new Error(`refusing to write non-volatile path ${op.path.join(".")}`);
		for (let attempt = 0; attempt < 3; attempt++) {
			if (attempt > 0) await refresh();
			const response = await remote.mutate(namespace, ops, namespaceView()?.revision);
			if (response.ok) {
				await refresh();
				return;
			}
			if (isConflict(response) && attempt < 2) continue;
			throw new Error(response.error?.message ?? onRefused);
		}
	};
	const writePath = (path, value) => writeOps([{
		op: "set",
		path,
		value
	}]);
	return {
		namespaceView,
		revisionOf: () => namespaceView()?.revision,
		readProviders: () => {
			const user = namespaceView()?.user;
			if (!isPlainObject(user)) return void 0;
			const providers = user.providers;
			return isPlainObject(providers) ? providers : void 0;
		},
		refresh,
		writeModels: (provider, models) => writePath([
			"providers",
			provider,
			"models"
		], models),
		writeOps,
		writePath
	};
}
//#endregion
//#region src/client/capacity.ts
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
const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/i;
/** Decimal suffix scales, matching how model capacities are quoted. */
const CAPACITY_SCALE = {
	k: 1e3,
	m: 1e6
};
/**
* Read a typed capacity.
*
* @param text - raw field text.
* @returns the token count, `undefined` when blank (meaning "inherit"), or
*   `NaN` when unreadable — the same three outcomes the official parser has.
*/
function parseCapacity(text) {
	const trimmed = text.trim();
	if (trimmed.length === 0) return void 0;
	const match = CAPACITY_PATTERN.exec(trimmed);
	if (match === null) return NaN;
	const suffix = match[2]?.toLowerCase();
	const scale = suffix === "k" || suffix === "m" ? CAPACITY_SCALE[suffix] : 1;
	const scaled = Number(match[1]) * scale;
	const rounded = Math.round(scaled);
	return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled;
}
//#endregion
//#region src/client/components/Card.tsx
/**
* The plugin's only UI: one card in the Models page footer.
*
* Five compact controls and a button. There is no catalog, no probing, no
* auto-run and no per-provider control — the card exists so a person can type a
* spec once and have every external provider adopt it.
*
* @module
*/
const panel = {
	border: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.25))",
	borderRadius: "var(--dsw-radius-md, 10px)",
	padding: "10px 12px",
	display: "flex",
	flexDirection: "column",
	gap: 8,
	fontSize: 13,
	lineHeight: 1.5,
	color: "var(--dsw-alias-label-primary, inherit)",
	/**
	* The models page offers no top-of-page slot, only `settings.models.footer`.
	* That slot's anchor renders with `display: contents`, so this card is a real
	* child of the page's column container — which makes `order` the supported way
	* to put it first without touching anyone else's DOM.
	*/
	order: -1
};
const headerStyle = {
	display: "flex",
	alignItems: "baseline",
	gap: 8,
	flexWrap: "wrap"
};
const titleStyle = {
	fontWeight: 600,
	fontSize: 13
};
const muted = {
	color: "var(--dsw-alias-label-secondary, inherit)",
	fontSize: 11.5
};
const danger = {
	color: "var(--dsw-alias-state-error-primary, #d9534f)",
	fontSize: 11.5
};
const rowStyle = {
	display: "flex",
	alignItems: "flex-end",
	gap: 8,
	flexWrap: "wrap"
};
const fieldStyle = {
	display: "flex",
	flexDirection: "column",
	gap: 2,
	fontSize: 11,
	color: "var(--dsw-alias-label-secondary, inherit)"
};
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
const inputStyle = {
	boxSizing: "border-box",
	height: 28,
	border: "1px solid var(--dsw-alias-border-l4, rgba(127,127,127,0.35))",
	borderRadius: "var(--dsw-radius-md, 6px)",
	background: "var(--dsw-alias-bg-layer-1, Canvas)",
	color: "var(--dsw-alias-label-primary, CanvasText)",
	font: "inherit",
	fontSize: 12,
	padding: "0 8px",
	width: 84
};
const selectStyle = {
	...inputStyle,
	width: "auto",
	paddingRight: 6,
	cursor: "pointer"
};
/** Options carry the same pair, so the popup rows never depend on inheritance. */
const optionStyle = {
	background: "var(--dsw-alias-bg-layer-1, Canvas)",
	color: "var(--dsw-alias-label-primary, CanvasText)"
};
const buttonStyle = {
	border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))",
	borderRadius: "var(--dsw-radius-md, 6px)",
	padding: "4px 12px",
	fontSize: 12,
	fontWeight: 600,
	cursor: "pointer",
	background: "var(--dsw-alias-bg-layer-1, Canvas)",
	color: "var(--dsw-alias-label-primary, CanvasText)",
	marginLeft: "auto"
};
const buttonOff = {
	...buttonStyle,
	opacity: .5,
	cursor: "not-allowed"
};
const IMAGE_MODES = [
	"keep",
	"support",
	"text"
];
const THINKING_MODES = [
	"on",
	"off",
	"keep"
];
/** The levels this plugin always declares, so a default here always applies. */
const EFFORT_CHOICES = [
	"low",
	"high",
	"max"
];
function imageLabel(t, mode) {
	if (mode === "support") return t("imageSupport");
	if (mode === "text") return t("imageText");
	return t("imageKeep");
}
function thinkingLabel(t, mode) {
	if (mode === "on") return t("thinkingOn");
	if (mode === "off") return t("thinkingOff");
	return t("thinkingKeep");
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
function readSpec(contextText, outputText, image, thinking, effort) {
	const level = effort === "clear" ? "clear" : EFFORT_CHOICES.find((choice) => choice === effort);
	const rest = {
		image,
		thinking,
		...level === void 0 ? {} : { defaultEffort: level }
	};
	const contextWindow = parseCapacity(contextText);
	if (typeof contextWindow === "number" && Number.isNaN(contextWindow)) return {
		spec: rest,
		badField: "context"
	};
	const maxTokens = parseCapacity(outputText);
	if (typeof maxTokens === "number" && Number.isNaN(maxTokens)) return {
		spec: rest,
		badField: "output"
	};
	return { spec: {
		...contextWindow === void 0 ? {} : { contextWindow },
		...maxTokens === void 0 ? {} : { maxTokens },
		...rest
	} };
}
function problemText(t, problem, preview) {
	switch (problem) {
		case "bad-context": return t("badContext");
		case "bad-output": return t("badOutput");
		case "bad-effort": return t("badEffort");
		case "no-providers": return t("noProviders");
		case "impossible": return format(t("impossible"), { list: preview.offenders.length > 0 ? preview.offenders.join("、") : "—" });
		case "nothing": return t("nothing");
	}
}
/**
* The card.
*
* @param props - the controller and the active translation function.
* @returns the rendered card.
*/
function AutoConfigCard({ controller, t }) {
	const [contextText, setContextText] = (0, react.useState)("");
	const [outputText, setOutputText] = (0, react.useState)("");
	const [image, setImage] = (0, react.useState)("keep");
	const [thinking, setThinking] = (0, react.useState)("on");
	const [effort, setEffort] = (0, react.useState)("");
	const [busy, setBusy] = (0, react.useState)(false);
	const [note, setNote] = (0, react.useState)(void 0);
	const [failed, setFailed] = (0, react.useState)(false);
	const { spec, badField } = readSpec(contextText, outputText, image, thinking, effort);
	const preview = controller.preview(spec);
	const blocked = badField !== void 0 || preview.missing || !preview.writable;
	const canApply = !busy && !blocked && preview.changed > 0;
	const run = (0, react.useCallback)(async () => {
		setBusy(true);
		setFailed(false);
		setNote(void 0);
		try {
			const outcome = await controller.apply(spec);
			if (outcome.ok) setNote(outcome.changed > 0 ? format(t("done"), {
				changed: outcome.changed,
				providers: outcome.providers
			}) : t("noChange"));
			else {
				setFailed(true);
				setNote(outcome.reason === "no-settings" ? t("noSettings") : format(t("refused"), { message: outcome.message ?? "" }));
			}
		} catch (error) {
			setFailed(true);
			setNote(format(t("refused"), { message: error instanceof Error ? error.message : String(error) }));
		} finally {
			setBusy(false);
		}
	}, [
		controller,
		spec,
		t
	]);
	const trigger = spec.contextWindow !== void 0 && spec.maxTokens !== void 0 ? triggerOf(spec.contextWindow, spec.maxTokens) : void 0;
	const hints = [];
	if (thinking === "on") hints.push(t("thinkingNote"));
	if (effort === "clear") hints.push(t("effortClearNote"));
	else if (effort !== "") hints.push(format(t("effortNote"), { effort }));
	if (thinking === "off" && effort !== "" && effort !== "clear") hints.push(t("effortOffNote"));
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		style: panel,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: headerStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: titleStyle,
					children: t("cardTitle")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: muted,
					children: t("cardIntro")
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: rowStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: fieldStyle,
						children: [t("fieldContext"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: inputStyle,
							value: contextText,
							placeholder: t("placeholderContext"),
							onChange: (event) => setContextText(event.target.value)
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: fieldStyle,
						children: [t("fieldOutput"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: inputStyle,
							value: outputText,
							placeholder: t("placeholderOutput"),
							onChange: (event) => setOutputText(event.target.value)
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: fieldStyle,
						children: [t("fieldImage"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
							style: selectStyle,
							value: image,
							onChange: (event) => setImage(event.target.value),
							children: IMAGE_MODES.map((mode) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: mode,
								style: optionStyle,
								children: imageLabel(t, mode)
							}, mode))
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: fieldStyle,
						children: [t("fieldThinking"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
							style: selectStyle,
							value: thinking,
							onChange: (event) => setThinking(event.target.value),
							children: THINKING_MODES.map((mode) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: mode,
								style: optionStyle,
								children: thinkingLabel(t, mode)
							}, mode))
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: fieldStyle,
						children: [t("fieldEffort"), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							style: selectStyle,
							value: effort,
							onChange: (event) => setEffort(event.target.value),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "",
									style: optionStyle,
									children: t("effortUnset")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "clear",
									style: optionStyle,
									children: t("effortClear")
								}),
								EFFORT_CHOICES.map((choice) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: choice,
									style: optionStyle,
									children: choice
								}, choice))
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: canApply ? buttonStyle : buttonOff,
						disabled: !canApply,
						onClick: () => {
							run();
						},
						children: busy ? t("applying") : t("apply")
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: rowStyle,
				children: preview.missing ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: danger,
					children: t("noSettings")
				}) : preview.problem === "nothing" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: muted,
					children: t("nothing")
				}) : preview.problem !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: danger,
					children: problemText(t, preview.problem, preview)
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: muted,
						children: [
							format(t("scope"), {
								providers: preview.providers,
								models: preview.models
							}),
							" · ",
							format(t("willChange"), { changed: preview.changed })
						]
					}),
					trigger !== void 0 && trigger > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: muted,
						children: format(t("triggerNote"), {
							trigger: formatTokens(trigger),
							share: `${String(Math.round(trigger / (spec.contextWindow ?? 1) * 100))}%`
						})
					}) : null,
					preview.skipped.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: muted,
						children: format(t("skippedNote"), { list: preview.skipped.join("、") })
					}) : null
				] })
			}),
			badField !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: danger,
				children: badField === "context" ? t("badContext") : t("badOutput")
			}) : null,
			!preview.writable && !preview.missing ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: muted,
				children: t("readOnly")
			}) : null,
			note !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: failed ? danger : muted,
				role: "status",
				children: note
			}) : null,
			hints.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: muted,
				children: hints.join(" · ")
			}) : null,
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: muted,
				children: t("persistNote")
			})
		]
	});
}
//#endregion
//#region src/client/index.tsx
const name = "dsh-model-autoconfig";
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
const inject = [
	"slots",
	"locale",
	"configForms",
	"remote.settings"
];
/** The settings namespace that owns custom pi-ai routes. */
const API_NS = "llm-pi-ai";
/** Where the last failures are kept, for reading back after a restart. */
const FAILURE_KEY = "dsh-model-autoconfig:last-failure";
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
function reportFailure(scope, error) {
	const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	try {
		globalThis.console?.error?.(`[dsh-model-autoconfig] ${scope} failed:`, error);
	} catch {}
	try {
		const store = globalThis.localStorage;
		if (store !== void 0) {
			const previous = store.getItem(FAILURE_KEY);
			const line = JSON.stringify({
				scope,
				message,
				at: (/* @__PURE__ */ new Date()).toISOString()
			});
			const kept = previous === null ? [] : previous.split("\n").slice(-4);
			store.setItem(FAILURE_KEY, [...kept, line].join("\n"));
		}
	} catch {}
}
/**
* Run one setup step, reporting instead of throwing.
*
* @param scope - the step name, for the report.
* @param step - the step itself.
*/
function guard(scope, step) {
	try {
		step();
	} catch (error) {
		reportFailure(scope, error);
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
function apply(ctx) {
	guard("apply", () => {
		applyInner(ctx);
	});
}
/** The real body; see {@link apply} for why it is wrapped. */
function applyInner(ctx) {
	const services = ctx;
	const configForms = services.get("configForms");
	const remoteSettings = services.get("remote.settings");
	const slots = services.get("slots");
	const locale = services.get("locale");
	if (locale !== void 0) guard("locale copy", () => {
		ctx.effect(() => locale.register(NS, {
			zh,
			en
		}), "model-autoconfig: copy");
	});
	let t = (key, params) => {
		const table = zh[key] ?? key;
		return params === void 0 ? table : table.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
	};
	if (locale !== void 0) try {
		t = locale.bind(NS);
	} catch (error) {
		reportFailure("locale bind", error);
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
	const effect = (body, label) => {
		guard(label, () => {
			const register = ctx.effect;
			register(body, label);
		});
	};
	/**
	* Resolve the describe mirror without letting its absence — or a throwing
	* accessor — take the whole plugin down.
	*/
	const guessMirror = () => {
		if (configForms === void 0) return void 0;
		try {
			const face = configForms.describe();
			if (face === void 0 || typeof face.getSnapshot !== "function") return void 0;
			return face;
		} catch {
			return;
		}
	};
	const mirror = guessMirror();
	const settings = createSettingsAccess(mirror, remoteSettings, API_NS);
	if (mirror === void 0 && remoteSettings !== void 0) effect(() => {
		settings.refresh();
	}, "model-autoconfig: initial read");
	const controller = {
		preview: (spec) => {
			const view = settings.namespaceView();
			if (view === void 0) return {
				providers: 0,
				models: 0,
				changed: 0,
				skipped: [],
				offenders: [],
				missing: true,
				writable: false
			};
			const plan = planBulk(settings.readProviders() ?? {}, spec);
			return {
				providers: plan.providers,
				models: plan.models,
				changed: plan.changed,
				skipped: plan.skipped,
				offenders: plan.offenders,
				missing: false,
				writable: view.writable !== false,
				...plan.problem === void 0 ? {} : { problem: plan.problem }
			};
		},
		apply: async (spec) => {
			const providers = settings.readProviders();
			if (providers === void 0) return {
				ok: false,
				reason: "no-settings"
			};
			const plan = planBulk(providers, spec);
			if (plan.problem !== void 0) return {
				ok: false,
				reason: "refused",
				message: plan.problem
			};
			const ops = [];
			for (const write of plan.writes) {
				ops.push({
					op: "set",
					path: [
						"providers",
						write.provider,
						"models"
					],
					value: write.models
				});
				if (write.reasoning !== void 0) ops.push({
					op: "set",
					path: [
						"providers",
						write.provider,
						"reasoning"
					],
					value: write.reasoning
				});
				if (write.clearReasoning === true) ops.push({
					op: "unset",
					path: [
						"providers",
						write.provider,
						"reasoning"
					]
				});
			}
			if (ops.length === 0) return {
				ok: true,
				changed: 0,
				providers: 0
			};
			try {
				await settings.writeOps(ops);
			} catch (error) {
				return {
					ok: false,
					reason: "refused",
					message: error instanceof Error ? error.message : String(error)
				};
			}
			return {
				ok: true,
				changed: plan.changed,
				providers: plan.writes.length
			};
		}
	};
	if (slots !== void 0) {
		/**
		* `slots.register` that never throws.
		*
		* The slot core refuses a registration for several legitimate reasons — an
		* undeclared key, or a key/id already taken at this priority — and
		* `slots.inject` rethrows that refusal straight through `ctx.effect`, where
		* it would otherwise fail this loader entry and, with it, the whole web UI
		* boot. A refused seat costs one card; it must not cost the host.
		*/
		const safeRegister = (descriptor, render) => {
			try {
				return slots.register(descriptor, render);
			} catch (error) {
				reportFailure(`slot ${String(descriptor.name)}`, error);
				return () => {};
			}
		};
		effect(() => slots.inject("settings.models.footer", () => safeRegister({
			name: "settings.models.footer",
			id: "model-autoconfig",
			order: 40
		}, () => (0, react.createElement)(AutoConfigCard, {
			controller,
			t
		}))), "model-autoconfig: settings card");
	}
}
//#endregion
exports.apply = apply;
exports.inject = inject;
exports.name = name;

return module.exports; } });