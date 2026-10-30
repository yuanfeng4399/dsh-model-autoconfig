# 交接笔记

写给下一个接手的人（或压缩后的我自己）。只记**结论和证据**，不重复推导过程。

---

## 2026-10-30（第五轮：把卡片移到模型页最上方）

**约束**：「模型」页只声明了三个槽——`settings.models.provider-card`（keyed，每个提供方卡片里）、`settings.models.footer`（list，提供方列表之后）、`settings.models.sign-in`。**没有页首槽**。`settings.section` 是「一个设置页」级别的列表，注册进去会多出一个侧边栏页面，不是同一件事。

**做法**：仍然注册 `settings.models.footer`，但给卡片根元素加 `order: -1`。

为什么这能生效，是查过渲染层才敢写的：

- `renderSlot()` 渲染的是 `<SlotOutlet>`（`ui-renderer:350`）；
- `SlotOutlet` 的外层锚点 `ANCHOR_STYLE = { display: "contents" }`（`ui-renderer:1116`）——**不生成盒子**；
- 于是卡片的 `<section>` 成为最近 flex 容器的直接子项；
- 模型页的 `.section` 和 `.rows` 都是 `display:flex; flex-direction:column`（`client.js:58` 的 CSS 模块），`order:-1` 就把卡片排到最前。

`order` 只作用在自己的元素上，不碰别人的 DOM——符合 `ui-plugin.md` 那条「不要读别人的 DOM 来估算位置」。

**守护**：`card-render.ts` 断言渲染结果里存在 `order: -1`。

---

## 2026-10-30（第四轮：下拉框白底白字）

**症状**：卡片里三个 `<select>` 展开后，除高亮那一行外全部看不见字，鼠标划过去才显形。

**根因**：两个错误叠在一起。

1. **主题 token 全是编的。** 卡片用的是 `--dsw-border` / `--dsw-text` / `--dsw-surface` / `--dsw-input-bg` / `--dsw-accent` / `--dsw-danger`——**一个都不存在**。真实的 token 家族只有 `--dsw-alias-*`、`--dsw-radius-*`、`--dsw-specific-*`（`Theme.listTokens` 可查）。`var()` 找不到就退回兜底值，于是背景透明、文字继承。
2. **原生 `<select>` 的弹出层是用 select 自己的 `background` 和 `color` 画的。** 背景透明时 Chromium 退回白色画布，文字却是深色主题的浅色 → 白底白字。高亮行有蓝底所以能看见。

**修法**：照抄 DSH 自己的 `ModelsSection` 输入框样式（`client.js:58` 的 CSS 模块）：

```css
border: .5px solid var(--dsw-alias-border-l4);
border-radius: var(--dsw-radius-md);
background: var(--dsw-alias-bg-layer-1);   /* 关键：必须不透明 */
color: var(--dsw-alias-label-primary);
```

外加给每个 `<option>` 单独写 `background` / `color`（同一对 token），这样弹出层的每一行都不依赖继承。兜底值用 `Canvas` / `CanvasText` 系统色——跟随 OS 配色，比硬编码颜色安全。

**守护**：`card-render.ts` 新增一组断言——每个 `<option>` 必须自带 `background:` 和 `color:`，每个 `<select>` 的背景必须是 `var(--dsw-alias-bg-layer-1`，并且**任何 `--dsw-*` token 必须属于 alias / radius / specific 家族**。最后这条直接封死「编 token 名」这个错误类型。

---

## 2026-10-30（第三轮排查）

又抓出三个真问题：

### 1. 只填窗口时漏检「隐式输出上限」

行里没有 `maxTokens` **不等于无上限**——DSH 用 `DEFAULT_MAX_TOKENS = 32768`（`dsh-llm-pi-ai:961`）。所以窗口填 90000 时 `90000 − 32768 − 65536 < 0`，压缩照样死，而旧代码因为 `next.maxTokens === undefined` 直接跳过了检查。

现在用「该行实际生效的值」判：`next.maxTokens ?? provider.defaultMaxTokens ?? 32768`，窗口同理 `?? provider.defaultContextWindow ?? 262144`。并且只在本次**确实改了容量**（`spec.contextWindow` 或 `spec.maxTokens` 有值）时才判——已经坏掉但没被本次改动碰到的行不该阻塞一次无关的修复。

副作用：`{ contextWindow: 50000 }` 现在会同时标出所有没有显式 cap 的行，这是对的。

### 2. 写进去的默认档位改不回来

`providers.<route>.reasoning` 在 DSH 自己的「模型」页里**没有编辑入口**（只有模型的 `reasoningEfforts` 有 UI）。也就是说插件写进去之后，用户唯一的出路是手改 YAML。

所以下拉里加了「清除」，走 `{ op: 'unset', path: ['providers', route, 'reasoning'] }`，和设置放在同一次 mutate 里。`EffortChoice = ThinkingLevel | 'clear'`。

### 3. 文案 key 没有守护

`t('efforNote')` 这种拼错会原样显示在界面上，静态渲染测不出来。现在 `card-render.ts` 的 `t` 会对 `zh` 和 `en` 双向校验，缺 key 直接抛错。另有一次性的 `.probe/check-locale-keys.mjs` 扫全量：卡片用了 39 个 key，两份文案都齐全，也没有多余定义。

### 顺带确认的

- `providers.<route>.reasoning` 在**实时 schema** 里确实存在，取值就是那 7 个 const（`Config.listConfigs entry=include:llm-pi-ai`，schema 里 `"reasoning"` 在 171310 字节处）。不是猜的。
- 镜像由 DSH 自己在 `settings/document-updated` 时 `mirror.load()`（`ui-settings:1489`），写完界面不会停在旧值。
- `ensure()` 是 `Promise.resolve().then(...)` 起跑（`:1393`），渲染期调用不会同步触发状态更新，不会死循环。

---

## 2026-10-30（下半场）：加思考模式与默认档位

**用户原话**：

> 再加上一个，设置思考模式可以设置开关，默认全部打开然后每个API都有max档位。这个思考模式是现在版本支持的你就写个默认打开然后添加mx就行。然后看看能不能加个设置默认思考档位的？就是每次切换API会使用这个默认的思考档位。注意做好后前端界面要比较清爽信息密度高。然后再检查bug

### 三个必须记住的 DSH 事实

1. **`THINKING_LEVELS` = `off, minimal, low, medium, high, xhigh, max`**（`dsh-llm-pi-ai/lib/index.js:299`）。
2. **`xhigh` 和 `max` 只有显式写进 `reasoningEfforts` 才会出现在选择器里**（`getSupportedThinkingLevels`，`:776`：`if (level === 'xhigh' || level === 'max') return mapped !== void 0;`）。其余档位不声明也能选。**这就是「加个 max」的全部含义。**
3. **`providers.<route>.reasoning` 就是「默认思考档位」**。它经 `describableReasoningLevel(resolvedModel, profile.reasoning)`（`:1914`）变成每个模型的 `defaultEffort`（`:1813`），选择器在无显式选择时用它（`options.reasoningEffort ?? profile.reasoning`，`:1953`）。模型不支持该档位时返回 `undefined` —— **静默忽略，不报错**，所以写 `max` 是安全的。

### 校验规则（写错会让整家提供方消失）

`resolveModelReasoning`（`:585`）对 `reasoningEfforts` 的要求：

- 不能是空对象（`{}` / `null` 都会 `invalid(...)`）；
- 除 `off` 外，每一档必须是**非空字符串**；`off` 可以是 `null`；
- 至少要有一档不是 `off`。

一旦某行不合法，**整条路由解析失败，该提供方的所有模型从所有选择器里消失**。所以 `thinkingOn()` 会把 `xhigh: null`、`medium: ''` 这类脏声明**删掉**，而不是原样保留——保留比丢弃危险得多。

### 实现要点

- `thinking: 'on'` → `reasoningEfforts = { low:'low', high:'high', max:'max', ...已有 }`，已有档位（如 `medium`）保留。
- `thinking: 'off'` → `reasoningEfforts = false`。
- `defaultEffort` 在 `thinking === 'off'` 时**不写**（模型都不思考了，默认档位是死配置）。
- 下拉只提供 `low / high / max` 三档：正是插件保证会写的三档，选了必然生效。

### 顺带修掉的架构问题

原来 `apply` 是**逐提供方** `mutate`，中途失败会留下写了一半的配置。现在把全部提供方的 op 打包进**一次** `settings.mutate`：

```ts
ops.push({ op: 'set', path: ['providers', provider, 'models'], value })
ops.push({ op: 'set', path: ['providers', provider, 'reasoning'], value })
await settings.writeOps(ops)   // 一次调用，整批成功或整批不动
```

`settings-access.ts` 新增 `writeOps(ops)`，`writePath` 变成它的单条包装。`partial` 文案随之删除。

### 界面密度

五个控件一行（`flex-wrap`，标签 11px、输入 12px），下面一到三行状态：范围 · 变化数 · 触发点 · 提示 · 持久化说明。没有分组标题、没有说明段落、没有第二个按钮。

---

## 2026-10-30：功能按用户要求砍到只剩一件事

**用户原话**：

> 修改一下这个插件的功能为：
> 1.可一键统一修改除官方deepseek外所有api的模型的输入输出上下文长度以及是否支持图片。就这个，而且 删除插件后dsh和原版没有区别，只是模型的上下文这些有改动而已。

所以整个「智能匹配」体系被拆掉了：models.dev 规格表、端点探测、家族匹配、共识投票、推理等级推断、按触发点换算窗口、DOM 注入的浮动按钮、每个提供方的单独动作——**全部删除**。

### 现在的结构

```
src/index.ts                     Host 半边，空实现（27 行，没变）
src/client/model-fields.ts       全部逻辑：范围、规划、触发点算术（纯函数）
src/client/index.tsx             挂载：locale + 一个 slot + controller
src/client/components/Card.tsx   三个输入框 + 一个按钮
src/client/settings-access.ts   设置读写层（没变，见下文「设置层」）
src/client/capacity.ts           300K / 1M 解析（砍掉了 ratio）
src/client/locales.ts            中英文案
```

删掉的：`catalog.ts`、`lookup.ts`、`shared.ts`、`client/catalog-store.ts`、`client/fill.ts`、`client/draft.ts`、`client/draft-fill.ts`、`client/inject.ts`、`client/card-anchor.ts`、`client/probe.ts`、`client/compaction.ts`、`client/providers.ts`、`components/ProviderCardAction.tsx`。

构建产物从 **110.29 kB 降到 30.6 kB**。

### 「删除插件后和原版没区别」是怎么保证的

不是靠承诺，是靠**产物上的断言**。`test/bundle-harness.mjs` 静态扫描 `lib/client.js`，下面每一个都必须出现 **0 次**：

`setInterval` `setTimeout` `MutationObserver` `ResizeObserver` `IntersectionObserver` `fetch(` `XMLHttpRequest` `WebSocket` `EventSource` `addEventListener` `requestAnimationFrame`

另外还动态导入 `lib/index.js`，用一个 Proxy 当 ctx 调 `apply()`，断言**一次属性访问都没有**（`touched === 0`）。

### 关键实现细节（容易踩的）

**`model-fields.ts` 是纯函数**，输入是 `llm-pi-ai` 的 `providers` 记录，输出是每个提供方的新 `models` 数组。三条不变量：

1. `deepseek-account` / `deepseek-official` 在循环里第一个 `continue`，连模型都不数。
2. **已经一致就不写**：`touched === 0` 的行原样返回，整家没变化就不产生 write。这让连点两次是空操作，也让设置 revision 不动。
3. 输入文档**不被修改**（每个改动行都是 `{...row}` 拷贝），测试里有 JSON 前后比对。

**`changed` 数的是字段数不是行数**。一行改三个字段算 3。

**触发点**：`Math.floor(Math.min(w * 0.8, w - maxTokens - 65536))`。`<= 0` 时 `compaction-basic` 每步抛 `TargetPressureConfigError`，主动压缩永久死掉。所以 `planBulk` 在**写之前**就返回 `problem: 'impossible'`，一个字节都不写。

**`input` 字段**：`dsh-llm-pi-ai/lib/index.js:282` 定义 `MODALITIES = ['text','image']`，`:1039` 的 schema 是 `z.array(z.union(MODALITIES))`。`:705` 有 `declaredInput(...) ?? base?.input ?? [...request.defaultInput]` 兜底，`DEFAULT_INPUT = ['text']`（`:972`）。所以**不写 `input` 是安全的**，DSH 会回落到默认值——「不修改」这个选项成立。

### 设置层（上一版就有的结论，仍然有效）

- **读**走 describe 镜像 `configForms.describe().getSnapshot().view.namespaces[].user`，同步、不发请求。
- **写**走 `remote.settings.mutate(ns, [{op:'set', path, value}], revision)`，返回**信封** `{ok:false,error:{code,message}}`，不抛异常。并发冲突的 code 是字符串 `'settings/conflict'`，不是类名。
- **必须写 dotted 服务名** `get('remote.settings')`。写成 `get('remote').settings` 会抛 `cannot get property "remote.settings" without inject`，然后整个 web UI 启动失败。
- 写入路径固定 `['providers', <route>, 'models']`，`writablePath()` 只放行 `path[0] === 'providers'`。
- 每次都从镜像重新读 revision，所以逐提供方连续写时用的是最新 revision。

### 门禁

```
test/verify-all.mjs  →  3 组，96 条断言
  bundles load, register one card, and write the right thing   42
  bulk planning and scope                                      33
  settings contract                                            21
```

另外有一个**真实配置试运行**（不在门禁里，手工跑）：

```powershell
& $node ..\.probe\dry-run-profile.mjs
# 8 个提供方 / 9 个模型 / 18 处变化 / 无字段丢失 / 二次应用为空操作
```

`.probe/yaml-lite.mjs` 是为它写的 YAML 子集解析器（只支持块映射、块序列、标量、简单 flow collection；遇到锚点/块标量会**主动抛错**而不是瞎猜）。

---

## ⚠️ 工具链教训：不要用 PowerShell 往返带中文的源文件

`Get-Content -Raw` → `Set-Content -Encoding UTF8` 会把非 ASCII 字符**静默损坏**（按 GBK 误解码）：

| 原字符 | UTF-8 字节 | 损坏后 |
|---|---|---|
| `—` | `E2 80 94` | `鈥` + 下一个字节被吞 <!-- allow-mojibake --> |
| `；` | `EF BC 9B` | `锛` + 下一个字节被吞 <!-- allow-mojibake --> |
| `·` | `C2 B7` | `路` <!-- allow-mojibake --> |
| `（点击关闭）` | 多字节 | `锛堢偣鍑诲叧闂級` <!-- allow-mojibake --> |

**注意被吞掉的字节**：`— ` 的空格、`join('；')` 的收尾引号都会消失，只替换乱码字符是不够的。

**规则：改这些文件用 `edit`/`write` 工具或 Node 脚本，绝不用 PowerShell 的 `Get-Content`/`Set-Content`。**
`Set-Content -Encoding UTF8` 还会加 BOM，破坏 `JSON.parse`。

顺带：`Get-Content` **读**显示出来的 `鈥?` 只是控制台按 GBK 解码的假象，文件本身可能是好的——要判断真伪必须用 Node 读 codepoint。`.probe/find-bad-encoding.mjs` 做这件事，`allow-mojibake` 标记用于豁免本文档里的示例行。

---

## ⚠️ 反复出现的故障：bundle 丢了，patch 还留着

**已经发生过两次**（2026-10-27 之后、以及 10-29 22:18）。症状：

- `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 里**没有** `dsh-model-autoconfig`
- 但 `dependencies` 里还有它，`cordis.patch.yml:213` 也还有 `- id: model-autoconfig`
- 结果：插件完全不加载，而 patch 条目指向一个不存在的 entry

这正是「感觉插件在影响 DSH 但其实它根本没跑」的来源。修法（`install_bundle` 会报 `already-installed`，所以必须先 remove）：

```
plugin_manager set_plugin enabled:false target:include:model-autoconfig   # 可能报 unknown-plugin，正常
Remove-Item -Recurse -Force ...\node_modules\dsh-model-autoconfig
plugin_manager remove_bundle  target:dsh-model-autoconfig
plugin_manager install_bundle target:file:E:/.../dsh-model-autoconfig
```

装完核对三件事：`bundles` 里有它、`list_plugins` 里 `fiberPhase: active`、`Slots.listSubTree settings.models.footer` 的 occupant 是 `dsh-model-autoconfig`。

**客户端要刷新页面**才会加载新的 `lib/client.js`。

---

## ⚠️ 事故记录：DSH「安全模式」会覆盖 cordis.patch.yml

启动失败时 DSH 会弹「安全模式」，点下去会用备份**覆盖 `cordis.patch.yml` 并重置 `dsh.profile.bundles`**。已经发生过两次，证据是这两个文件：

- `cordis.patch.yml.bak-safemode-20261005-130246` → 1,225 B
- `cordis.patch.yml.bak-safemode2-20261005-133557` → 1,039 B

（正常配置 6 KB 左右。那两个 1 KB 的文件就是「8 家提供方全没了」的样子。）

**永远不要点那个对话框里的「禁用第三方插件」/ 重置。** 要恢复就从同目录按体积最大的 `.bak-*` 还原。

---

## 重要的调查结论（别再重复查）

**插件不在请求链路上。** Host 半边空实现，客户端产物里 `ctx.on(` 出现 0 次。它唯一写进请求体的值是 `maxTokens`（DSH 发成 `max_tokens`）。

**`max_tokens` 不影响速度。** 受控 A/B（同中转、同提示、交替 3 轮）：`max_tokens=4096` 中位 371.7 tok/s，`max_tokens=128000` 中位 430.9 tok/s；同档位内部离散度 103–697 tok/s，比两档差大一个数量级。

**慢是提供方的事。** 把上下文锁在 100K–250K 再比：weekday 295.9 tok/s、codex666 263.8、flux 162.6、lingfeng 165.8。flux 自己在退化：10-05 中位 273.7 → 10-27 148.0 → 10-29 60.2 tok/s。

**首 token 时间随上下文陡增**（flux）：≤50K 2,907 ms → 50–100K 5,902 → 100–150K 7,858 → 200–300K 11,750。所以「触发点调高」确实会让体感变慢，但那是上下文长度的代价，不是 CPU 开销。

**界面没有卡顿**：会话日志里 text chunk 间隔 `median=0ms`、`p99≤131ms`、`≥300ms` 只占 0.18%–0.55%，无周期性尖峰。

**诊断脚本都在 `../.probe/`**：`provider-matched.mjs`（同上下文比提供方）、`ttft.mjs`（首 token 随上下文）、`speed-trend.mjs`（按天趋势）、`max-tokens-ab.mjs`（A/B）、`stream-speed.mjs`（流式速率与停顿形状）、`dry-run-profile.mjs`（对真实配置试运行）。

会话日志是**多个独立 zstd frame 拼接**的，`zstdDecompressSync` 整块解只拿到第一帧——必须按 magic `28 b5 2f fd` 切开逐帧解。脚本里都有 `decodeFrames()`。

**`contextWindow` 不能删。** `dsh-compaction-basic/lib/index.js:940`：`if (info.context === void 0) throw new TargetPressureConfigError(...)`。删掉这个字段 = 主动压缩永久失效。

---

## 项目位置

- 插件：`E:\mycode\游戏大全\测试文件夹\制作插件\dsh-model-autoconfig`
- 诊断脚本：`E:\mycode\游戏大全\测试文件夹\制作插件\.probe`
- Profile：`C:\Users\ASUS\.dsh\profiles\desktop`
- 会话日志：`C:\Users\ASUS\.dsh\sessions`
- DSH 安装：`E:\develop\DeepSeek Harness`（`app.asar` 里的包要用 `.probe/asar-*.mjs` 读，PowerShell 看不见）

工具链：

```powershell
$node = "C:\Users\ASUS\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
```

`node_modules/typescript`、`node_modules/tsdown` 都在插件目录下。

---

## 用户的核心诉求（原话要点）

1. 「这是一个插件不要影响到原本的dsh功能，如果我关闭后就会回到最初的dsh而不会出现错误互不干扰。」
2. 「可一键统一修改除官方deepseek外所有api的模型的输入输出上下文长度以及是否支持图片。就这个。」
3. 「删除插件后dsh和原版没有区别，只是模型的上下文这些有改动而已。」
4. 不要自动更新；手动触发；官方 DeepSeek 不碰。

前两条是 0.3.0 的全部设计约束。任何新功能先问：它会不会留下运行时痕迹？会不会让「删除即复原」不成立？
