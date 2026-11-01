# SkillFlux 站点优化计划

> 依据：2026-11-01 对线上站（skillflux.app）的全面审查。
> 覆盖：首页、`/skills/`、技能详情页、`/for-ai/`、`/quality/`、`/compare/`、中文版 `/zh/`、⌘K 全局搜索，以及机器层 `AGENTS.md`、`llms.txt`、`/data/claims.json`、`.md` 报告、HTML head alternate 声明。

## 执行状态（2026-11-01）

- ✅ 已完成：#1（移除 Google Analytics，隐私页注明 Cloudflare Web Analytics）、#2、#3、#4、#5、#6、#7（`--faint` 调为 #6b6557，三种底色均 ≥ 4.5:1）、#8、#9、#10、#12，以及 AI 面的 flag 人话对照（`llms.txt`、`AGENTS.md` 路由、技能 `.md` 报告；JSON 保留原始代码）。
- ⏸ 未做：#11（保留分类筛选，只调整了间距）、#14 / #15（运营与内容事项，不属于前端改动）。

## 设计目标（评估基准）

1. **人类页面 = 简单可读**：人来浏览和判断，具体执行交给 AI。页面要让人不读细节也能得出结论。
2. **AI 页面 = 知道哪些可信、已证实**：机器层要能区分"SkillFlux 验证过的陈述"和"来源自述"，并附证据链。

## 总体结论

- 目标 1（人读）：**基本达标，约 80 分**。信息架构和视觉统一性好；短板在表格图例位置、详情页结论可视化、少量措辞与对比度。
- 目标 2（AI 面）：**达标，约 90 分**。`claims.json` 的 `verified` 标记、sha256 清单、不可变方法论、引用规则、`.md` alternate 是同类站少见的设计；仅 flag 代码对照一处缺口。

---

## 优先级总览

| # | 事项 | 目标 | 优先级 | 工作量 | 主要文件 |
|---|------|------|--------|--------|----------|
| 1 | 隐私页与 Google Analytics 的矛盾 | 信任 | **P0** | S | `PolicyPage.astro` / `BaseLayout.astro` |
| 2 | `/skills/` 表格图例上移到表头上方 | 人读 | **P0** | S | `SkillsIndexPage.astro` |
| 3 | 详情页顶部增加结论统计条 + "未实测"提示框 | 人读 | **P0** | M | `SkillReportPage.astro` |
| 4 | 详情页 21 行检查表瘦身（说明收纳、文件名折叠） | 人读 | P1 | M | `SkillReportPage.astro` |
| 5 | License 列措辞（"Own file" / "单独文件"） | 人读 | P1 | S | `SkillsIndexPage.astro` / `i18n.ts` |
| 6 | 统计卡中行排版（"benchmarked · none published yet"） | 人读 | P1 | S | `SkillsIndexPage.astro` |
| 7 | 灰色辅助文字对比度提升 | 人读 | P1 | S | `global.css` |
| 8 | 表格行高一致性（flag 子文本导致不齐） | 人读 | P1 | S | `SkillsIndexPage.astro` |
| 9 | 中文排版细节（表头字距、标点、行高） | 人读 | P1 | S | `global.css` |
| 10 | 详情页侧栏 sticky、元数据上移 | 人读 | P2 | S | `SkillReportPage.astro` / `global.css` |
| 11 | 筛选 chips 换行与必要性 | 人读 | P2 | S | `SkillsIndexPage.astro` |
| 12 | `llms.txt` 输出 flag 人话对照 | AI | P1 | S | `llms.txt.ts` / `skill-data.ts` |
| 13 | 发布第一个 benchmark run | 内容 | **P0**（运营） | L | bench 流水线 |

---

## P0 — 信任一致性

### 1. 隐私页声称"无第三方追踪脚本"，但每页加载 GA

**证据**：
- `src/components/PolicyPage.astro`（privacy 段）：*"我们不在页面中嵌入广告或第三方追踪脚本。/ Pages embed no ads or third-party tracking scripts."*
- `src/layouts/BaseLayout.astro:44-65`：生产环境注入 gtag.js（`G-WQ21XK35B3`）。

**为什么 P0**：站点品牌是"证据与诚实"（"Agents get evidence, not marketing"），隐私页与实际行为的矛盾是对品牌最大的单点伤害，且是既有的已知未决问题。

**方案（二选一）**：
- **A（推荐）**：如实披露。在隐私页"基础访问日志"条目旁新增一条"网站统计"：说明使用 Google Analytics、收集哪些数据（页面浏览、近似地理位置、无广告、不跨站投放），并给出 Google 隐私政策链接；中英文同步。
- **B**：移除 GA（删 `BaseLayout.astro` 中的注入与 `cfBeaconToken` 相关逻辑），保持隐私页原文。

**验收**：隐私页每一条陈述都与页面实际加载的脚本一一对应；中英文一致。

## P0 — 人类阅读关键路径

### 2. `/skills/` 三色数字徽章缺少就地图例

**证据**：表格中每行的 `16 0 0` 三色徽章无标签；图例 *"Health check columns: passes · warnings · failures"* 位于 45 行表格最底部，首访者无法在视线接触徽章时理解含义。

**方案**：把图例移到表头上方（一行小字 + 三个色点示例：`● 16 通过 · ● 0 警告 · ● 0 失败`）；表头 "Health check" 保留。同时给徽章加 `title`/`aria-label`（如 "16 pass, 0 warn, 0 fail"）。

**验收**：不滚动到表格底部即可凭图例读懂徽章；屏幕阅读器能读出每个徽章含义。

### 3. 技能详情页结论埋在文字里

**证据**：页面首段是一整句话（"…recorded 16 passes, 0 warnings and 0 failures, plus 5 informational results, across 21 checks; it has not been benchmarked yet."），数字不可扫读；"尚未实测"这一最重要限定只在句尾和中部区块出现。

**方案**：
- 在标题下方加统计条：`16 通过 | 0 警告 | 0 失败 | 5 信息`（复用 `/skills/` 的三色徽章语言，保持全站一致）。
- "未实测 / Not benchmarked yet" 做成带边框的醒目提示条，放在统计条正下方，替代纯文字。

**验收**：打开详情页 3 秒内，不读正文即可知道结论和"未实测"这一限定。

---

## P1 — 阅读体验

### 4. 详情页 21 行检查表瘦身

**证据**：每行重复"检查是干什么的"说明文字；`scripts.present` 的 Detail 把 5 个文件名连成一大段逗号串；Info 与 Pass 混排无分组。

**方案**：
- 检查说明移入 `title` 悬浮或 `<details>` 展开，表格只留代码名 + 结果徽章 + 摘要。
- 文件名列表折叠为 `5 files ▾`，展开显示完整列表。
- 结果列改为带底色的小徽章（Pass 绿 / Warn 黄 / Fail 红 / Info 灰），全表可扫。
- 可选：Info 组与 Pass 组分行段显示。

**验收**：表格 21 行在一屏内大致可扫完；最长 Detail 不再撑破行高。

### 5. License 列措辞

**证据**：英文 "Own file"、中文"单独文件"含义模糊；与 MIT/Apache-2.0 混排时不属同一类别。

**方案**：改为 "License file in repo"（中文："仓库内附许可证"）或加 `title` 悬浮说明；缺失时显示 "Not found"（中文"未找到"），保留 `—` 只用于"不适用"。

### 6. 统计卡中行排版

**证据**：`/skills/` 顶部统计卡中，"—" + "benchmarked · none published yet" 夹在 45 与 19 两个大数字之间，乍看像数据缺失。

**方案**：该槽位不做大数字，改为小号标签样式（如 `实测：尚未发布`），或将三格布局改为"两数字 + 一状态行"，消除破折号的歧义。首页第 4 格 "In progress" 同理统一处理。

### 7. 灰色辅助文字对比度

**证据**：米白底上的次级文字（副标题、flag 说明、"Try" 标签、语言切换）约 4:1 或更低，处于 WCAG AA 边缘。

**方案**：`global.css` 中将次级文字色加深一档（目标 ≥ 4.5:1）；语言切换 "EN / 中" 单独加深。用浏览器 Lighthouse/axe 跑一遍全站对比度检查。

### 8. 表格行高一致性

**证据**：带 flag 子文本的行明显更高，45 行节奏不齐。

**方案**：flag 子文本固定高度行（一行截断 + `title` 全文），或将 flag 移为徽章后的悬浮，主表行高统一。

### 9. 中文排版细节

**证据**：CJK 表头被应用西文 letter-spacing（"体 检"显得松散）；全角标点行尾无挤压；正文行高对中文偏紧；筛选 chip 内数字紧贴中文。

**方案**：
- `global.css`：为 `:lang(zh)` 的表头/标签类移除 letter-spacing（已有 `.page-title` 的先例可循，`global.css:213`）。
- 中文正文行高提到 1.75–1.8；启用 `text-autospace`/标点挤压（`text-spacing-trim`，Chromium 已支持，渐进增强）。
- chip 内"标签 + 数字"之间加薄空隙。

---

## P2 — 打磨

### 10. 详情页侧栏

侧栏在长页面下方大量留白；把"元数据卡（含 Tested commit，即信任锚点）"上移到首屏右侧，并 `position: sticky`。

### 11. 筛选 chips

45 个技能 8 个分类，筛选价值有限且换行不齐。可选：与分类计数合并为单行紧凑布局，或 45→100+ 项之前干脆移除筛选、只保留分类锚点。

### 12. 首页统计第 4 格

"In progress" 与前三格大数字节奏不一致，与第 6 项一并统一。

---

## AI 面（目标 2）

### 13. `llms.txt` flag 代码加人话对照 ✅ 缺口，其余已达标

**证据**：`llms.txt` 技能行输出 `flags: executes-code, destructive-commands` 等内部代号；`FLAG_LABELS`（`src/lib/skill-data.ts:115`）已存在中英人话映射，只是没用于机器层输出。

**方案**：`llms.txt.ts` 输出时改为 `flags: executes-code (bundles scripts the agent may run)`，或在文件头部加一张 flag 对照表（代码 → 人话 → "是描述不是判决"）。`AGENTS.md` 的 Routing 段同步引用该表。

**验收**：AI 只读 `llms.txt` 即可正确转述 flag 含义，不会生硬直译代号。

### 已达标项（保持，勿回退）

- `claims.json`：每条陈述 `verified: true/false` + 证据 URL + commit SHA。
- `AGENTS.md`：阅读顺序、引用规则（n、95% 区间、模型、日期、run id）、路由、边界。
- `/data/index.json` sha256 清单；`/methodology/v1/` 不可变。
- 每个 HTML 页 head 内 `text/markdown` alternate（技能页与来源页均已验证存在）。
- `.md` 报告内嵌引用与边界规则。
- ⌘K 搜索：ARIA 语义完整、过滤、状态计数、类型徽章（Skill report / Source）均正常——无需改动。

---

## 内容与运营（非代码，但决定站点成立）

### 14. 发布第一个 benchmark run（P0 级运营事项）

全站当前承诺与占位都指向"与不装 Skill 基线的对照实测"，而 `benchmarked: 0`。发布首跑将同时：填掉全站 "not benchmarked yet" 提示、让 llms.txt 的 "Benchmarked skills" 段落首次有内容、验证 bench→publish 流水线端到端可用。建议先跑 3–5 个高关注技能（如 pdf、tdd、code-review）。

### 15. Insights 与数据更新节奏

首页 "RECENT EDITORIAL UPDATES" 与 `UPDATED` 日期是信任信号，保持每周检查数据 + 每月至少一篇 deep-dive 的节奏即可。

---

## 建议实施顺序

1. **第 1 批（半天）**：#1 隐私/GA、#2 图例上移、#5 License 措辞、#12+#6 统计槽位——全是小改，先消掉"信任矛盾"和最扎眼的可读性问题。
2. **第 2 批（1–2 天）**：#3 详情页统计条与提示框、#4 检查表瘦身、#7 对比度、#8 行高——详情页是核心页面，一次改透。
3. **第 3 批（半天）**：#9 中文排版、#10 侧栏、#11 筛选、#13 llms.txt flag 对照。
4. **并行推进**：#14 首个 benchmark run（不受前端改动阻塞）。

每批完成后跑 `web` 测试套件 + Lighthouse（对比度/可访问性），中文页面单独过一遍视觉。
