---
title: "Reverse Engineer Anything 拆解：用认识论纪律约束逆向分析的 Agent 范式"
description: "深度拆解 reverse-engineer-anything：从目标类型的首工具路由、无害诊断的配置修复、静态到运行时的证据分级，到严格区分观察、推断与未知的台账机制，看专业逆向工作流如何将实事求是编码为 Agent 铁律。"
datePublished: "2026-10-16"
dateModified: "2026-10-16"
industry: "安全工程 / 二进制与应用逆向"
skillName: "reverse-engineer-anything"
source:
  repo: "https://github.com/morluto/rea"
  author: "morluto"
  authorUrl: "https://github.com/morluto"
  license: "MIT（Copyright (c) 2026 morluto）"
tags: ["Agent Skills", "开源", "GitHub", "MCP", "安全"]
relatedSites:
  - "github-com-morluto-rea"
tldr: "reverse-engineer-anything 建立了由目标构件类型决定首选工具的路由体系，用「观察、推断、未知」三元分类与 Evidence ID 证据台账约束推理，并强制要求证据强度逐级递进，严禁由静态分析脑补运行时因果。"
scenarios:
  - "面对 Electron ASAR、Android APK、固件镜像或原生 ELF/PE 产物，需要逆向核心业务逻辑或提取隐藏接口"
  - "对比两个软件版本或发行构件间的符号、结构与行为差异，排查隐蔽的功能变更或退化"
  - "分析离线崩溃转储（Core Dump）或网络捕获（HAR），在不接触活体目标的情况下还原现场"
  - "在仅有二进制产物而缺乏源码的环境下指导系统重建，需要建立逐条可验证的证据链"
workflow:
  - step: "目标识别与首工具路由"
    detail: "根据输入目标是 ASAR、APK、固件、EVM 字节码、ELF 还是崩溃转储，直接查表匹配首个分析工具；普通源码架构分析则退出本 Skill。"
  - step: "无害诊断与克制连接"
    detail: "检查 REA 工具可用性；若失联仅运行只读 doctor 区分原因，通过 dry-run 审查配置修复方案并获批，绝不擅自安装系统级重型依赖。"
  - step: "清单驱动的分阶段调查"
    detail: "将复杂需求转化为明确的子问题与证据需求清单，从最小可用概览切入，围绕单一假设批量获取证据，避免盲目遍历。"
  - step: "证据台账与认知归类"
    detail: "为每个结论绑定 Evidence ID，严格标识观察、推断或未知状态；仅当静态证据无法闭环且具备环境时才引入被动运行时观测。"
  - step: "边界复核与会话释放"
    detail: "逐项复核清单确认已解决、部分解决或未解项，声明有界负向搜索的范围，调查结束后调用 close_binary 释放原生会话。"
judgments:
  - "入口由目标产物类型决定，不由分析习惯决定：ASAR 走 JS 树分析、APK 走包检查、ELF 走二进制布局，禁止用一把通用工具敲所有钉子。"
  - "结论必须严格区分观察（Observation）、推断（Inference）与未知（Unknown）：绝不暗示静态分析观察到了执行，未证实猜测必须显式降级。"
  - "静态差异是候选假设，而非因果证明：对比构件或函数差异只能证明代码不同，不能直接断定导致了某项外部运行行为变化。"
  - "运行时观察到的 Bundle 不等于其包含的模块均已执行：运行时证据仅证实加载与捕获轨迹，不能向未执行模块外推活性。"
  - "诊断先于行动，绝不越权乱装系统依赖：修 MCP 配置不等于安装 Node/Java/Ghidra/IDA，遇到缺少环境宁可降级 CLI 或退出，不破坏宿主底座。"
  - "普通源码仓库架构分析明确不在 REA 范围内：清楚定义自己什么时候不该介入，是防止 Agent 上下文污染与过度工程的关键设计。"
painPoints:
  - pain: "LLM 做逆向时容易「脑补因果」，把静态反编译看到的函数调用直接武断描述为系统运行时必然发生的行为"
    solution: "引入认识论纪律与 Evidence ID 绑定，强制区分观察、推断与未知，静态证据不足时才按需引入被动运行时核对"
  - pain: "面对复杂分析任务时 Agent 盲目乱试工具、随意更改宿主配置，甚至擅自安装大型逆向套件导致环境污染"
    solution: "通过类型路由表锁定第一步入口；MCP 修复流程实行「只读诊断 → dry-run 审批 → 范围执行」，严禁代装系统工具"
  - pain: "多步骤逆向推导后上下文剧烈膨胀，早期结论丢失依据，后续复查无法证实或证伪"
    solution: "建立 Finding Ledger 台账，结论、证据 ID、置信度与未解缺口双向引用，未解问题使用 record_unknown 追踪修订"
limitations:
  - "重型运行依赖：完整原生二进制、Android 与固件分析依赖本地或宿主预装的 REA MCP server、Java/JADX、Ghidra/IDA、Binwalk/Unblob 等第三方工具链，非开箱即用的纯提示词 Skill。"
  - "凭据与网络安全边界：网络抓包（HAR/mitmproxy）与运行时观测默认主动过滤 Cookie、Authorization、Token 等敏感凭据且不做线上归因；被动观测不主动触发页面交互。"
  - "文本与规范拆解边界：本篇为基于已收录源码与引用文档的架构与方法论拆解，未在测试环境中实际启动逆向引擎进行靶标验证。"
draft: false
---

## 入口路由与连接克制：从「习惯驱动」到「目标驱动」

当开发者让一个大语言模型「分析这个软件的行为」时，最典型的 Agent 反应往往是发散的：随手执行 `file` 或 `strings`，全局搜索几个猜测的关键词，或者试图启动一个重量级的反编译图形界面。这种基于直觉或通用经验的探索，在复杂交付物面前极易耗尽上下文并陷入死循环。

`reverse-engineer-anything`（REA）的第一项硬性约束是**由目标决定首个工具（Route the target first）**。它维护了一张近乎机械的映射规则：

- 遇到 Electron ASAR 或解包 JS 树，必须首选 `analyze_javascript_application`，而不是解构整个归档；
- 遇到 Android APK 代码分析，首选 `inspect_android_package`；若仅查看清单文件则使用通用的 `open_binary`；
- 面对固件镜像，首选 `inspect_firmware_regions`；
- 遇到 EVM 字节码，首选纯离线接口解析 `inspect_evm_interface`，禁止执行或链上广播；
- 遇到 Linux 崩溃转储，首选 `inspect_recorded_crash`，明确区分历史记录中的 PID 与当前宿主进程；
- 面对原生二进制，才进入 `open_binary` 并在必要时拉取 `binary_overview`。

这套路由不仅规范了工具调用序列，更重要的是建立了明确的**自我边界感**。REA 在正文第一段就确立了一条红线：*如果是普通源码仓库的架构分析，明确不在本 Skill 范围内，应使用普通仓库工具，不运行 REA 的任何准备命令*。能清晰界定「何时不应该使用自己」，是专业级 Skill 区别于野蛮生长的全能 Prompt 的重要分水岭。

这种克制同样体现在它的**连接与维护纪律**中：安装此 Skill 仅获得指令，并不等于安装了 MCP 服务或逆向套件。当环境失联时，REA 严禁 Agent 贸然修改配置或在宿主中执行诸如 `apt-get install ghidra` 或升级 Node.js 的破坏性行为。它将失联原因细分为丢失（missing）、失效（stale）与未对齐（misaligned），并强制执行「只读诊断（`doctor`）→ 差异演练（`dry-run`）→ 人工批准 → 范围执行」的防御性运维流程。在无 MCP 的极端场景下，它甚至提供了直接调用 CLI 产出 Evidence 记录的降级路径。

## 认识论纪律：绝不暗示静态分析观察到了执行

大模型参与代码与二进制分析时最致命的幻觉，并非「看不懂指令」，而是「混淆代码的存在与代码的执行」。

假设逆向人员在某款桌面客户端反编译后的伪代码中，看到了这样一段逻辑：

```c
if (feature_flag & 0x08) {
    send_billing_beacon(user_id, token);
}
```

未经严格训练的 Agent 极易给出这样的断言：「当用户触发该功能时，客户端会向计费服务器发送带有用户凭证的遥测信标。」这一陈述在工程上是不可靠的：该分支是否在生产编译中被优化？`feature_flag` 在运行时是否曾被置位？网络请求是否被上层拦截器屏蔽？

REA 将这种审慎编码为**认识论纪律（Work summary-first）**。在 REA 的输出规范中，任何结论必须严格划分为三类：
1. **观察（Observation）**：工具直接提取到的物理证据，例如「在函数 `sub_14001` 的偏移 `+0x3A` 处存在一条指向 `send_billing_beacon` 的 call 指令」，必须标注唯一的 Evidence ID。
2. **推断（Inference）**：由观察衍生出的技术假说，例如「该代码块可能用于计费上报，但触发依赖标志位 `0x08`」。
3. **未知（Unknown）**：当前分析无法覆盖的盲区，例如「标志位 `0x08` 的赋值路径在静态调用图中未闭环，运行时状态未知」。

REA 明确写下一条铁律：*绝不暗示静态分析观察到了执行（never imply that static analysis observed execution）*。

即便进入了动态分析阶段，这种审慎也没有打折。在其被动运行时观测规范中，REA 再次给出了一个反直觉却极为扎实的判断：*在运行时观察到某个 Bundle 被加载，并不证明该 Bundle 中包含的每一个模块都曾执行（A bundle observed at runtime does not prove every contained module executed）*。它将「静态差异」与「运行时追踪」严格视为候选假说而非因果证明，并通过 `record_unknown` 强制登记尚未解决的技术缺口。这种将事实、推论与盲区分离的严苛格式，为长链条逆向提供了抗幻觉的认知底座。

## 证据需求清单与发现台账：驾驭长程逆向的认知熵增

逆向工程本质上是一场在信息海洋中收敛假设的过程。面对数十万行反编译代码或包含数千个文件的固件镜像，盲目深度遍历必然导致上下文中充满无关细节，最终引发信息漂移。

REA 的解法是**清单驱动与分阶段推进（Plan broader investigations）**：

```
复杂分析诉求 → 问题清单 + 证据类型定义
  ↓
检查已有会话与分析库（避免重复初始化）
  ↓
最小概览切入（Overview / Inventory）
  ↓
围绕单一假设批量操作（Batch related operations）
  ↓
静态证据受阻且具备条件 → 引入被动运行时观测
  ↓
维护 Finding Ledger（结论 ↔ Evidence ID ↔ 置信度 ↔ 未解项）
  ↓
闭环复核：标明已解决 / 部分解决 / 未知（保持负向搜索边界）
```

这一流程展现了极高的经济性与证据分级思想：
- **从低成本到高成本**：从最小的元数据与目录清单开始，仅当特定子问题需要时才展开深入分析；只有在静态反编译无法得出结论且环境允许时，才升级到被动运行时观测（如 CDP 探针或 mitmproxy 流量回放）。
- **发现台账（Finding Ledger）**：不依赖模型的发散记忆，而是维护一份紧凑的索引表，将结论、证据 ID、置信度和剩余未知项锁定在结构化记录中。这使得后续的多轮对话或并行分析人员（Parallel Workers）可以基于一致的证据事实继续推进。
- **有界负向搜索（Bounded Negative Search）**：在逆向中，证明「存在某种行为」只需要一个证据，但要证明「不存在某种漏洞或后门」，穷举是不可行的。REA 要求在得出否定性结论时，必须诚实声明搜索边界（例如「在解密后的前 10 个核心模块中未检索到相关符号」），而不是妄称「系统绝对不存在该行为」。

在数据安全与合规层面，REA 也贯彻了极高的一致性：其网络与运行时捕获能力在底层默认剔除了 Cookie、Authorization 头部与身份令牌，不抓取活体凭据，且明确不对网络流量做线上主动归因。

## 可迁移的 Agent 元模式

如果把视角从逆向工程抽离出来，REA 所展现出的架构设计，对所有需要处理复杂系统、排查疑难故障或审计未知代码的 Agent 具有极强的普适价值：

1. **认知防火墙：存在性 ≠ 执行性**  
   在代码审查、架构评估或安全排查中，Agent 极易将「代码库里写了这段逻辑」直接推论为「系统必然按此运行」。REA 示范了如何在 prompt 层面强制建立「物理事实（观察）与逻辑推测（推断）」的防火墙，要求推断必须带证据 ID 并降级置信度。
2. **工具路由优于自由探索**  
   对于具有多种输入类型的复杂专业领域，与其让模型每次自行判断调用哪个工具，不如建立一套基于输入产物签名（扩展名、文件头、格式特征）的显式路由表。收敛首个动作往往能决定整场分析的信噪比。
3. **破坏性操作的审批闭环**  
   在涉及系统级改动（如 MCP 配置修复、开发环境调试）时，杜绝 Agent 的自主扩张欲。严格遵循「只读检测、dry-run 预览变更、等待人工确认」的三部曲，是让 Agent 在真实开发机上安全运行的底线。
4. **诚实对待未知与负向结论**  
   优秀的专家系统不仅知道自己找到了什么，更清楚自己没看到什么。通过未知项台账（Unknown Registry）和声明搜索边界，Agent 能向人类用户交付真正具备确定性、可证伪且经得起同行评议的严谨结论。

---

本文依据提交 `c701376777212ec9acfd10c97f45b1eaf0c885c6` 的 [SKILL.md](https://github.com/morluto/rea/blob/c701376777212ec9acfd10c97f45b1eaf0c885c6/skill-src/reverse-engineer-anything/SKILL.md) 及其 [References 目录文档](https://github.com/morluto/rea/tree/c701376777212ec9acfd10c97f45b1eaf0c885c6/references)。本篇系架构与工程方法论拆解，未在测试环境中实际启动逆向引擎进行靶标验证。完整收录范围与包信息参见[资源详情](/resource/morluto-rea/)。
