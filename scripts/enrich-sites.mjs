// One-off enrichment: inject longSummary + faqs for sites that lack them.
// Content is grounded in each site's self-descriptive name, category, type,
// pricing, region/language, and trust level — no fabricated metrics.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("../data/sites.json", import.meta.url));
const sites = JSON.parse(readFileSync(path, "utf8"));

const content = {
  "agent-skills-md": {
    longSummary:
      "agent-skills.md 是一个面向全球用户的英文 Agent Skills 综合目录,用简洁的 Markdown 风格把可复用的 agent 能力集中列出,便于快速浏览和查阅。\n\n作为综合目录类来源,它的价值在于“一处看全“而非独家内容,适合在挑选具体 skill 前先建立整体印象。在 SkillFlux 的收录里,它与其他英文目录站并列,可信度为中等,免费使用。",
    faqs: [
      { q: "agent-skills.md 是什么?", a: "一个英文的 Agent Skills 综合目录,以 Markdown 风格集中列出可复用的 agent 能力,便于浏览查阅。" },
      { q: "agent-skills.md 收费吗?", a: "免费。" }
    ]
  },
  "agentskill-sh": {
    longSummary:
      "AgentSkill.sh 是一个面向全球开发者的英文 Agent Skills 目录站,把散落各处的 agent 能力聚合到统一入口,方便按需检索。\n\n它属于综合目录类来源,定位是发现和对比而非托管。免费使用,可信度中等。如果你在做多站横向筛选,可以把它和其他英文目录放在一起参考。",
    faqs: [
      { q: "AgentSkill.sh 是什么?", a: "一个英文的 Agent Skills 目录站,把各处的 agent 能力聚合到统一入口,便于按需检索。" },
      { q: "它适合谁使用?", a: "适合需要跨站发现和对比 agent skill 的英文用户。" }
    ]
  },
  "aitmpl-com": {
    longSummary:
      "AITmpl 是一个英文 Agent Skills 集合入口,把可复用的 agent 能力(模板/技能)整理成便于取用的列表。\n\n作为综合目录类来源,它适合快速发现与检索。免费使用,可信度中等。在 SkillFlux 的分类中,它归入综合目录,可与官方厂商合集互补:先在目录看广度,再回到可信来源做取舍。",
    faqs: [
      { q: "AITmpl 是什么?", a: "一个英文的 Agent Skills 集合入口,把可复用的 agent 能力整理成便于取用的列表。" },
      { q: "AITmpl 收费吗?", a: "免费。" }
    ]
  },
  "github-com-anthropics-skills": {
    longSummary:
      "anthropics/skills 是 Anthropic 官方在 GitHub 上维护的开源 skill 仓库,是 Claude Skills 最权威的源头之一。内容开源、透明、可审计,可以直接看到每个 skill 的实现。\n\n在 SkillFlux 的收录中,它被标为高可信度——对于会在 agent 环境中执行的能力,官方源头意味着更低的风险。适合希望以第一手、可信来源为基准的开发者,也适合作为理解 skill 规范的参考。",
    faqs: [
      { q: "anthropics/skills 是什么?", a: "Anthropic 官方在 GitHub 维护的开源 skill 仓库,是 Claude Skills 权威源头之一。" },
      { q: "它可信吗?", a: "可信度高。作为官方开源仓库,内容透明可审计,适合作为第一手基准来源。" },
      { q: "使用需要付费吗?", a: "免费,开源。" }
    ]
  },
  "github-com-bradautomates-claude-video": {
    longSummary:
      "bradautomates/claude-video 是一个专注视频场景的开源 skill 项目,面向需要让 agent 处理视频相关任务的用户。作为单一主题的开源仓库,它的代码公开、可审计、可自行改造。\n\n在 SkillFlux 中它归入开源仓库类,可信度较高。适合已经明确要做视频相关能力、并愿意基于开源项目定制的开发者。",
    faqs: [
      { q: "claude-video 是做什么的?", a: "一个专注视频场景的开源 skill 项目,面向需要让 agent 处理视频相关任务的用户。" },
      { q: "它是开源的吗?", a: "是。代码公开,可审计、可自行改造,免费使用。" }
    ]
  },
  "claudemarketplaces-com": {
    longSummary:
      "Claude Marketplaces 是一个面向 Claude 生态的英文 skill 市场入口,把可用的能力集中呈现,便于按需挑选。\n\n作为市场类来源,它通常提供比单一仓库更广的覆盖面。免费使用,可信度中等。适合在多个市场之间横向比较、寻找合适能力的用户。",
    faqs: [
      { q: "Claude Marketplaces 是什么?", a: "一个面向 Claude 生态的英文 skill 市场入口,集中呈现可用能力,便于按需挑选。" },
      { q: "它收费吗?", a: "免费浏览。" }
    ]
  },
  "claude-plugins-dev": {
    longSummary:
      "Claude Plugins 是一个英文的 Claude 能力/插件集合入口,把面向 Claude 的可复用能力聚合展示。\n\n它属于市场类来源,定位是发现与取用。免费使用,可信度中等。如果你在围绕 Claude 搭建工作流,可以把它作为寻找现成能力的一个入口。",
    faqs: [
      { q: "Claude Plugins 是什么?", a: "一个英文的 Claude 能力/插件集合入口,聚合面向 Claude 的可复用能力。" },
      { q: "适合谁使用?", a: "适合围绕 Claude 搭建工作流、需要寻找现成能力的用户。" }
    ]
  },
  "claudeskillsmarket-com": {
    longSummary:
      "Claude Skills Market 是一个面向企业场景的英文 skill 市场,既有免费能力也有付费/企业级内容,定位偏商业采购。\n\n它的定价为部分付费,可信度中等。适合有预算、希望获得商业支持或企业级 skill 的团队;个人用户也可以从中的免费部分入手。",
    faqs: [
      { q: "Claude Skills Market 是什么?", a: "一个面向企业场景的英文 skill 市场,含免费与付费/企业级内容。" },
      { q: "它收费吗?", a: "部分付费。有免费能力,也有付费或企业级内容。" }
    ]
  },
  "clawhub-ai": {
    longSummary:
      "ClawHub 是一个新兴的英文 Agent Skills 集合入口,把 agent 能力聚合到一处方便检索。作为较新的站点,内容和生态仍在成长中。\n\n在 SkillFlux 中它的可信度标记为“新兴”——适合关注新来源、愿意尝鲜的用户,但用于生产前建议先核对 skill 的维护状态。免费使用。",
    faqs: [
      { q: "ClawHub 是什么?", a: "一个新兴的英文 Agent Skills 集合入口,聚合 agent 能力便于检索。" },
      { q: "它成熟吗?", a: "属于新兴来源,生态仍在成长中,用于生产前建议核对 skill 维护状态。" }
    ]
  },
  "discoveraiskills-com": {
    longSummary:
      "Discover AI Skills 是一个偏社区发现导向的英文 skill 站点,帮助用户发现新的 agent 能力、了解当下有哪些选择。\n\n作为社区类来源,它更适合探索和了解趋势,而非作为权威基准。免费使用,可信度中等。适合想扩展视野、发现新 skill 的用户。",
    faqs: [
      { q: "Discover AI Skills 是什么?", a: "一个偏社区发现导向的英文 skill 站点,帮助发现新的 agent 能力。" },
      { q: "适合谁使用?", a: "适合想探索趋势、发现新 skill 的用户。" }
    ]
  },
  "hermes-agent-nousresearch-com-docs-zh-hans-skills": {
    longSummary:
      "Hermes Agent Skills 是 Nous Research 的 Hermes Agent 官方文档中的 skill 部分,提供简体中文文档,面向使用 Hermes 生态的中文用户。\n\n作为官方文档来源,它的内容与 Hermes Agent 直接对应,权威性较好。免费使用,可信度中等。适合正在使用或评估 Hermes Agent、需要中文资料的用户。",
    faqs: [
      { q: "Hermes Agent Skills 是什么?", a: "Nous Research 的 Hermes Agent 官方文档中的 skill 部分,提供简体中文文档。" },
      { q: "它是中文的吗?", a: "是,提供简体中文文档。" }
    ]
  },
  "llmskills-org": {
    longSummary:
      "LLM Skills 是一个英文的 Agent Skills 集合入口,以 LLM 能力为主题把可复用的 skill 汇总展示。\n\n它属于综合目录类来源,定位是发现与检索。免费使用,可信度中等。适合按主题浏览、寻找面向大模型 agent 的现成能力的用户。",
    faqs: [
      { q: "LLM Skills 是什么?", a: "一个英文的 Agent Skills 集合入口,以 LLM 能力为主题汇总可复用 skill。" },
      { q: "它收费吗?", a: "免费。" }
    ]
  },
  "mcpmarket-com-zh-tools-skills-leaderboard": {
    longSummary:
      "MCPMarket Skills Leaderboard 是 MCPMarket 旗下的 skill 排行榜,以中文呈现,按热度/采用度对 agent skill 排序,兼具 MCP 与 skill 两个视角。\n\n作为社区榜单类来源,它反映真实热度,适合快速看到“大家都在用什么”。免费使用,可信度中等。适合想通过热度信号发现优质 skill 的中文用户。",
    faqs: [
      { q: "MCPMarket Skills Leaderboard 是什么?", a: "MCPMarket 旗下的中文 skill 排行榜,按热度/采用度对 agent skill 排序。" },
      { q: "它适合做什么?", a: "适合通过热度信号快速发现大家都在用的 skill。" }
    ]
  },
  "github-com-op7418-humanizer-zh": {
    longSummary:
      "op7418/Humanizer-zh 是一个专注写作/文本“人性化“的开源 skill 项目,面向中文写作场景,帮助让 AI 生成的文本更自然。作为开源仓库,代码公开、可审计、可自行改造。\n\n在 SkillFlux 中它归入开源仓库类,可信度较高,带“写作“标签。适合做中文内容创作、需要提升文本自然度的用户。",
    faqs: [
      { q: "Humanizer-zh 是做什么的?", a: "一个专注中文写作/文本人性化的开源 skill,帮助让 AI 生成文本更自然。" },
      { q: "它是开源的吗?", a: "是,代码公开可审计,免费使用。" }
    ]
  },
  "github-com-othmanadi-planning-with-files": {
    longSummary:
      "OthmanAdi/planning-with-files 是一个开源 skill 项目,主题是“用文件做规划”——让 agent 借助文件来组织和推进任务规划。代码公开,可审计、可改造。\n\n在 SkillFlux 中它归入开源仓库类,可信度较高。适合关注 agent 规划工作流、想参考或复用相关做法的开发者。",
    faqs: [
      { q: "planning-with-files 是做什么的?", a: "一个开源 skill,主题是让 agent 借助文件来组织和推进任务规划。" },
      { q: "它是开源的吗?", a: "是,代码公开,免费使用。" }
    ]
  },
  "qoder-com-zh-marketplace": {
    longSummary:
      "Qoder Marketplace 是 Qoder 的官方市场(中文),提供面向其生态的 agent skill,既有免费也有付费内容。作为厂商自营市场,内容与 Qoder 平台直接对应。\n\n它的定价为部分付费,可信度较高。适合已经在使用 Qoder、希望就近获取配套 skill 的中文用户。",
    faqs: [
      { q: "Qoder Marketplace 是什么?", a: "Qoder 的官方中文市场,提供面向其生态的 agent skill,含免费与付费内容。" },
      { q: "它收费吗?", a: "部分付费。" }
    ]
  },
  "skillhub-club": {
    longSummary:
      "SkillHub Club 是一个英文的 Agent Skills 集合入口,把 agent 能力汇总到一处,便于浏览和检索。\n\n它属于综合目录类来源,免费使用,可信度中等。适合需要跨来源发现 skill 的英文用户,可与官方合集互补使用。",
    faqs: [
      { q: "SkillHub Club 是什么?", a: "一个英文的 Agent Skills 集合入口,汇总 agent 能力便于浏览检索。" },
      { q: "它收费吗?", a: "免费。" }
    ]
  },
  "skillsdirectory-com": {
    longSummary:
      "Skills Directory 是一个英文 Agent Skills 目录站,以目录形式集中列出可用的 agent 能力,方便按需查找。\n\n作为综合目录类来源,它的价值在于覆盖面和检索效率。免费使用,可信度中等。适合先看广度、再深入具体 skill 的英文用户。",
    faqs: [
      { q: "Skills Directory 是什么?", a: "一个英文 Agent Skills 目录站,以目录形式集中列出可用能力,便于查找。" },
      { q: "它收费吗?", a: "免费。" }
    ]
  },
  "skills-homes-zh-cn-categories": {
    longSummary:
      "Skills Homes 是一个提供简体中文界面的 Agent Skills 目录,按分类组织 agent 能力,方便中文用户按类目浏览。\n\n作为综合目录类来源,它适合快速定位某一类 skill。免费使用,可信度中等。适合偏好中文界面、习惯按分类查找的用户。",
    faqs: [
      { q: "Skills Homes 是什么?", a: "一个中文界面的 Agent Skills 目录,按分类组织 agent 能力便于浏览。" },
      { q: "它是中文的吗?", a: "是,提供简体中文界面并按类目组织。" }
    ]
  },
  "skills-pub-zh": {
    longSummary:
      "Skills.pub 是一个提供中文页面的 Agent Skills 合集站,把可复用的 agent 能力集中呈现,面向中文用户。\n\n它属于综合目录类来源,免费使用,可信度中等。适合想用中文浏览、快速发现 skill 的用户。",
    faqs: [
      { q: "Skills.pub 是什么?", a: "一个提供中文页面的 Agent Skills 合集站,集中呈现可复用的 agent 能力。" },
      { q: "它收费吗?", a: "免费。" }
    ]
  },
  "skills-sh": {
    longSummary:
      "skills.sh 是一个英文 Agent Skills 合集入口,把 agent 能力聚合到统一域名下,风格简洁、便于开发者快速取用。\n\n在 SkillFlux 中它的可信度标为较高,免费使用。适合偏好命令行/开发者视角、希望快速发现和使用 skill 的英文用户。",
    faqs: [
      { q: "skills.sh 是什么?", a: "一个英文 Agent Skills 合集入口,风格简洁,便于开发者快速取用。" },
      { q: "它收费吗?", a: "免费。" }
    ]
  },
  "skillsllm-com": {
    longSummary:
      "SkillsLLM 是一个英文 Agent Skills 集合入口,聚焦大模型 agent 的可复用能力,汇总展示便于检索。\n\n作为综合目录类来源,免费使用,可信度中等。适合按大模型 agent 场景寻找现成能力的用户。",
    faqs: [
      { q: "SkillsLLM 是什么?", a: "一个英文 Agent Skills 集合入口,聚焦大模型 agent 的可复用能力。" },
      { q: "它收费吗?", a: "免费。" }
    ]
  },
  "skillsmp-com": {
    longSummary:
      "SkillsMP 是一个英文 Agent Skills 合集站,把 agent 能力集中列出,便于发现与对比。\n\n它属于综合目录类来源,免费使用,可信度中等。适合跨来源浏览、寻找合适 skill 的英文用户。",
    faqs: [
      { q: "SkillsMP 是什么?", a: "一个英文 Agent Skills 合集站,集中列出 agent 能力便于发现对比。" },
      { q: "它收费吗?", a: "免费。" }
    ]
  },
  "skywork-ai-skillhub-zh": {
    longSummary:
      "Skywork SkillHub 是 Skywork 官方推出的 skill 中心(中文),把面向其生态的 agent 能力集中提供。作为厂商官方来源,内容与 Skywork 平台对应。\n\n免费使用,可信度中等。适合正在使用或评估 Skywork、需要中文 skill 资料的用户。",
    faqs: [
      { q: "Skywork SkillHub 是什么?", a: "Skywork 官方的中文 skill 中心,集中提供面向其生态的 agent 能力。" },
      { q: "它是中文的吗?", a: "是,提供中文内容。" }
    ]
  },
  "tessl-io-registry": {
    longSummary:
      "Tessl Registry 是 Tessl 提供的 skill registry(注册表),以市场形式集中托管和分发 agent 能力,面向全球英文用户。\n\n免费使用,可信度中等。适合希望通过统一 registry 发现和获取 skill 的用户,尤其是关注 Tessl 生态的开发者。",
    faqs: [
      { q: "Tessl Registry 是什么?", a: "Tessl 提供的 skill registry,以市场形式集中托管和分发 agent 能力。" },
      { q: "它收费吗?", a: "免费。" }
    ]
  },
  "github-com-varunr89-resume-tailoring-skill": {
    longSummary:
      "varunr89/resume-tailoring-skill 是一个开源 skill 项目,主题是简历定制——帮助 agent 针对不同岗位调整和优化简历。代码公开,可审计、可自行改造。\n\n在 SkillFlux 中它归入开源仓库类,可信度较高,免费使用。适合做求职工具、或想复用简历定制能力的开发者。",
    faqs: [
      { q: "resume-tailoring-skill 是做什么的?", a: "一个开源 skill,帮助 agent 针对不同岗位调整和优化简历。" },
      { q: "它是开源的吗?", a: "是,代码公开,免费使用。" }
    ]
  },
  "github-com-obra-superpowers": {
    longSummary:
      "Superpowers(obra)是一个开源 skill 框架项目,带“框架“标签,提供组织和扩展 agent 能力的结构,而不只是单个 skill。代码公开,可审计、可扩展。\n\n在 SkillFlux 中它归入开源仓库类,可信度较高,免费使用。适合想系统化管理多个 skill、或在框架层面做定制的开发者。",
    faqs: [
      { q: "Superpowers 是什么?", a: "一个开源的 skill 框架项目,提供组织和扩展 agent 能力的结构。" },
      { q: "它和单个 skill 有什么不同?", a: "它是框架层面的项目,面向系统化管理和扩展多个能力,而非单一功能。" }
    ]
  },
  "github-com-composiohq-awesome-claude-skills": {
    longSummary:
      "awesome-claude-skills(Composio 维护)是一个开源的 Claude Skills 策展合集(awesome 列表),把值得关注的 skill 分类整理到一个 GitHub 仓库里。\n\n作为合集型开源仓库,它可信度较高、更新由社区推动,免费使用。适合系统性了解 Claude Skills 生态、按主题发现优质资源的用户。",
    faqs: [
      { q: "这个 awesome-claude-skills 是什么?", a: "Composio 维护的开源 Claude Skills 策展合集(awesome 列表),按主题整理值得关注的 skill。" },
      { q: "它收费吗?", a: "免费,开源。" }
    ]
  },
  "github-com-voltagent-awesome-agent-skills": {
    longSummary:
      "awesome-agent-skills(VoltAgent 维护)是一个开源的 agent skills 策展合集,把面向各类 agent 的可复用能力汇总到一个 awesome 列表中。\n\n可信度较高,由社区维护更新,免费使用。适合不局限于单一平台、想广泛了解 agent skill 生态的用户。",
    faqs: [
      { q: "awesome-agent-skills 是什么?", a: "VoltAgent 维护的开源 agent skills 策展合集,汇总面向各类 agent 的可复用能力。" },
      { q: "它收费吗?", a: "免费,开源。" }
    ]
  },
  "github-com-travisvn-awesome-claude-skills": {
    longSummary:
      "awesome-claude-skills(travisvn 维护)是一个开源的 Claude Skills 策展列表,由维护者收集整理值得关注的 skill 资源。\n\n作为合集型开源仓库,免费使用,可信度中等。适合作为发现 Claude Skills 的又一份社区参考,可与其他 awesome 列表对照着看。",
    faqs: [
      { q: "这个列表是什么?", a: "travisvn 维护的开源 Claude Skills 策展列表,收集整理值得关注的 skill。" },
      { q: "它收费吗?", a: "免费,开源。" }
    ]
  },
  "github-com-behisecc-awesome-claude-skills": {
    longSummary:
      "awesome-claude-skills(BehiSecc 维护)是一个带安全视角的开源 Claude Skills 策展合集,除了汇总 skill 资源,还带有“安全“标签,可能更关注安全相关的能力与实践。\n\n免费使用,可信度中等。适合关注 skill 安全性、或在安全场景下寻找相关能力的用户。",
    faqs: [
      { q: "这个列表有什么特点?", a: "BehiSecc 维护的开源 Claude Skills 合集,带安全视角,关注安全相关能力与实践。" },
      { q: "它收费吗?", a: "免费,开源。" }
    ]
  },
  "github-com-android-skills": {
    longSummary:
      "Android Skills 是 Android 官方(Google)在 GitHub 上维护的开源 skill 仓库,面向移动开发场景,带“官方“与”移动开发“标签。作为官方来源,权威性和可信度都很高。\n\n代码开源、可审计,免费使用。适合做 Android/移动开发、希望使用官方背书 skill 的开发者。",
    faqs: [
      { q: "Android Skills 是什么?", a: "Android 官方(Google)维护的开源 skill 仓库,面向移动开发场景。" },
      { q: "它可信吗?", a: "可信度高,是官方来源。开源、免费。" }
    ]
  },
  "github-com-expo-skills": {
    longSummary:
      "Expo Skills 是 Expo 官方在 GitHub 上维护的开源 skill 仓库,面向移动开发(React Native / Expo 生态),带“官方“与”移动开发“标签。作为官方来源,可信度高。\n\n代码开源、可审计,免费使用。适合使用 Expo/React Native、希望获得官方 skill 支持的开发者。",
    faqs: [
      { q: "Expo Skills 是什么?", a: "Expo 官方维护的开源 skill 仓库,面向 React Native / Expo 移动开发生态。" },
      { q: "它可信吗?", a: "可信度高,是官方来源。开源、免费。" }
    ]
  },
  "github-com-xu-xiang-everything-claude-code-zh": {
    longSummary:
      "everything-claude-code 中文版(xu-xiang 维护)是一个面向 Claude Code 的中文开源合集仓库,把与 Claude Code 相关的 skill、用法和资源整理成中文资料。\n\n作为合集型开源仓库,免费使用,可信度中等。适合中文用户系统学习和使用 Claude Code、寻找配套 skill 的场景。",
    faqs: [
      { q: "everything-claude-code 中文版是什么?", a: "面向 Claude Code 的中文开源合集,整理相关 skill、用法和资源。" },
      { q: "它是中文的吗?", a: "是,中文资料,开源免费。" }
    ]
  },
  "github-com-wlzh-skills": {
    longSummary:
      "wlzh/skills 是一个中文开源 skill 仓库,由个人维护,收录可复用的 agent 能力。代码公开、可审计、可自行改造。\n\n在 SkillFlux 中它归入开源仓库类,免费使用,可信度中等。适合中文开发者参考、复用或改造具体 skill。",
    faqs: [
      { q: "wlzh/skills 是什么?", a: "一个中文开源 skill 仓库,收录可复用的 agent 能力,代码公开。" },
      { q: "它是开源的吗?", a: "是,开源免费,可审计可改造。" }
    ]
  },
  "github-com-laolaoshiren-claude-code-skills-zh": {
    longSummary:
      "claude-code-skills-zh(laolaoshiren 维护)是一个面向 Claude Code 的中文开源 skill 合集,把相关 skill 汇总并配以中文说明,降低中文用户的上手门槛。\n\n作为合集型开源仓库,免费使用,可信度中等。适合想用中文学习 Claude Code skill、并直接取用的用户。",
    faqs: [
      { q: "claude-code-skills-zh 是什么?", a: "面向 Claude Code 的中文开源 skill 合集,汇总相关 skill 并配中文说明。" },
      { q: "它是中文的吗?", a: "是,中文说明,开源免费。" }
    ]
  }
};

// Canonical key order so injected fields land in the right place.
const order = [
  "id", "slug", "name", "canonicalUrl", "displayUrl", "tags", "category",
  "language", "region", "type", "scale", "pricing", "tagline", "summary",
  "longSummary", "aiSummary", "faqs", "featured", "recommended", "trustLevel",
  "status", "sourceUrls", "addedAt", "updatedAt"
];

let injected = 0;
const rebuilt = sites.map((site) => {
  const extra = content[site.slug];
  if (extra && !site.longSummary) {
    site.longSummary = extra.longSummary;
    site.faqs = extra.faqs;
    injected += 1;
  }
  const out = {};
  for (const key of order) {
    if (site[key] !== undefined) out[key] = site[key];
  }
  // Preserve any unexpected keys not in the canonical order.
  for (const key of Object.keys(site)) {
    if (!(key in out)) out[key] = site[key];
  }
  return out;
});

writeFileSync(path, JSON.stringify(rebuilt, null, 2) + "\n");
console.log(`Injected ${injected} sites. Total ${rebuilt.length}. With longSummary: ${rebuilt.filter((s) => s.longSummary).length}.`);
