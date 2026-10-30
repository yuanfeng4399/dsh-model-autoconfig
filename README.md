# dsh-model-autoconfig

给 DeepSeek Harness 的「设置 → 模型」页加一张卡片：**填一次，所有外部 API 提供方的每个模型都改成这套值。**

只改五样东西：

| 控件 | 写入位置 | 说明 |
|---|---|---|
| 输入上下文 | `contextWindow` | 模型能接收多少 token |
| 输出上限 | `maxTokens` | 单次最多生成多少 token |
| 图片 | `input` | `["text","image"]` 或 `["text"]`，也可以选「不修改」 |
| 思考模式 | `reasoningEfforts` | 开启 / 关闭 / 不修改，默认开启 |
| 默认档位 | `providers.<route>.reasoning` | 切换模型时选择器回落到这一档 |

官方 DeepSeek 路由（`deepseek-account` / `deepseek-official`）**永远不动**——它们住在另一个设置命名空间里，插件连看都不看。

## 思考模式

DSH 的档位是 `off / minimal / low / medium / high / xhigh / max` 七档，但**能不能选由模型声明决定**：

- 模型没声明 `reasoningEfforts` → 回落到内置目录，中转模型通常等于「不支持思考」，选择器里一档都没有。
- 声明了对象 → 只有写进去的档位才可选。
- **`xhigh` 和 `max` 是特例：不显式写进去就永远不出现**（`getSupportedThinkingLevels` 对这两档要求 `mapped !== undefined`）。

所以「开启」会把每个模型补成 `low / high / max` 三档，已有档位（比如 `medium`）原样保留：

```yaml
reasoningEfforts:
  low: low
  high: high
  max: max      # 不写这一行，max 档位在界面上根本不存在
```

「关闭」写 `reasoningEfforts: false`，模型变成非思考模型。

### 默认档位

`providers.<route>.reasoning` 是提供方级默认值。DSH 把它换算成每个模型的 `defaultEffort`，选择器在没有显式选择时就用它（`options.reasoningEffort ?? profile.reasoning`）。

所以设成 `max` 之后，**切到任何一家提供方，选择器默认就在 max 档**。下拉里只放 `low / high / max` 三档——正是插件保证会写入的三档，选了就一定生效；填一个模型没声明的档位只会被 DSH 静默忽略。

DSH 自己的「模型」页**没有** `providers.<route>.reasoning` 这个字段的编辑入口，所以下拉里还有一个「清除」：把这个键删掉，回到 DSH 自己的回落。写进去就改不回来这种事不该发生。

思考关闭时这一档不写入（模型连思考都不支持，默认档位是无意义的死配置）；但「清除」照常生效。

## 为什么是现在这个样子

这个插件的定位是**纯写入器**，不是运行时组件：

- Host 半边是空实现，不注册任何服务、不监听任何事件。
- 客户端只有一张卡片。**没有定时器、没有 MutationObserver、没有网络请求、没有 DOM 注入。**
- 启动时零开销；不打开「模型」设置页就完全不工作。

这些不是承诺，是**构建产物上的断言**：`test/bundle-harness.mjs` 会静态扫描 `lib/client.js`，`setInterval` / `setTimeout` / `MutationObserver` / `fetch(` / `addEventListener` / `requestAnimationFrame` 任何一个出现都会让门禁失败。

所以删掉插件之后，DSH 和原版**没有任何区别**——唯一的残留就是你已经写进 `llm-pi-ai` 的那几个模型值，那本来也是你要改的。

## 用起来是什么样

设置 → 模型 → **页面最上方**：

```
统一模型规格  一次写入所有外部 API 提供方的模型。官方 DeepSeek 不动。

输入上下文[300K] 输出上限[64K] 图片[支持图片▾] 思考模式[开启▾] 默认档位[max▾]        [一键应用]

8 个提供方 · 9 个模型 · 29 处会变化
压缩触发点 170,464（窗口的 57%）＝ min(窗口 × 80%, 窗口 − 输出 − 65,536)。
开启会补齐 low / high / max；max 只有显式声明才会出现在选择器里。 · 切换模型时选择器默认用 max。
删除插件后这些值保留，DSH 其余部分与原版一致。
```

五个控件一行排完，点之前就能看到**会改几个提供方、几个模型、多少处**，以及 DSH 实际会用哪个压缩触发点。

## 那个触发点是怎么回事

DSH 的压缩阈值是：

```
min(contextWindow × 0.8, contextWindow − maxTokens − 65,536)
```

第二个减项经常咬人：`maxTokens` 填大了，触发点会被压得很低。比如 300K 配 128K 输出，触发点是 **106,464**，不是 240,000。

极端情况下（`maxTokens` 大到把余量吃光）`compaction-basic` 会在每一步抛 `TargetPressureConfigError`，主动压缩永久失效，对话一路涨到中转的真实上限然后炸掉。所以卡片**拒绝**这种组合，不让你写进去。

几个参考值：

| 窗口 | 输出上限 | 触发点 | 触发点是窗口的 |
|---|---|---|---|
| 300K | 64K | 170,464 | 57% |
| 300K | 128K | 106,464 | 35% |
| 1M | 64K | 800,000 | 80% |
| 1M | 128K | 806,464 | 81% |

顺带一句实测结论：**首 token 时间随上下文长度陡增**（同一家中转，5 万上下文约 2.9 秒，20 万以上约 11.8 秒）。触发点设得越高，每次请求带的历史越长，等第一个字的时间越久。要快要慢，这个数字就是旋钮。

## 安装

在 DSH 里「设置 → 插件 → 从本地安装」，选这个目录；或者用插件管理器：

```powershell
# 装完刷新页面，卡片出现在「设置 → 模型」底部
```

## 卸载

直接停用或删除即可。**卸载是安全的**：插件不注册任何常驻的东西，删除它不会留下任何运行时代码。

要连写进去的值一起还原，把 `llm-pi-ai` 里各模型的 `contextWindow` / `maxTokens` / `input` 改回真实值就行——注意 `contextWindow` **不能删**，删了 `compaction-basic` 会因为缺少容量直接抛错、压缩永久失效。

## 数据来源

没有数据来源。这个版本不查 models.dev，不探测端点，不猜规格。你填什么就写什么。

（所以它也不会替你判断某个中转的真实上下文是多少——不确定的话，用中转商给的数字。）

## 已知边界

- **只写 `llm-pi-ai`**。官方 DeepSeek 路由在 `llm-deepseek`，插件不碰。
- **一次只写一套值**。不同提供方真实规格不同时，这套值对其中一些可能偏大或偏小 —— 这是「统一」的代价。
- **一次调用写完**。所有提供方的改动打包进同一次 `settings.mutate`，整批成功或整批不动，不会留下写了一半的配置。
- **`contextWindow` 只影响 DSH 的压缩判断**，不会改变中转实际能收多少。填大了 DSH 会更晚压缩，然后可能被中转拒绝。

## 开发

```powershell
$node = "C:\Users\ASUS\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node node_modules\typescript\bin\tsc --noEmit -p tsconfig.json      # 类型检查（含测试）
& $node node_modules\tsdown\dist\run.mjs                              # 构建
& $node node_modules\tsdown\dist\run.mjs --config tsdown.verify.config.ts
& $node test\verify-all.mjs                                           # 门禁
```

`test/verify-all.mjs` 跑三组检查、96 条断言：产物静态扫描 + 真实加载并驱动控制器 + 纯逻辑规划 + 设置读写契约。

真实的 profile 还可以做一次试运行：

```powershell
& $node ..\.probe\dry-run-profile.mjs "C:\Users\ASUS\.dsh\profiles\desktop\cordis.patch.yml"
```

## 许可证

MIT
