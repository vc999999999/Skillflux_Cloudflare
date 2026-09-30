import type { Language } from './i18n';

type Translation = Record<Language, string>;
export interface Scenario {
  slug: string; title: Translation; summary: Translation; updatedAt: string;
  sections: { title: Translation; body: Translation; command?: string }[];
  sourceCategories: string[];
}

export const scenarios: Scenario[] = [
  {
    slug: 'choose-a-source', updatedAt: '2026-09-06',
    title: { zh: '官方合集、市场和社区仓库，应该怎么选？', en: 'Vendor collections, marketplaces or community repositories?' },
    summary: { zh: '先看任务、来源和维护证据，再决定是否安装。黄页收录与精品质检是两个不同的判断。', en: 'Start with your task, provenance and maintenance evidence. Directory inclusion and curated-release approval are separate judgments.' },
    sourceCategories: ['official', 'marketplace', 'repo'],
    sections: [
      { title: { zh: '先写下你需要的结果', en: 'Describe the result you need' }, body: { zh: '用一句话描述任务的输入和期望输出，例如“把访谈记录整理成带证据索引的结论”。再确认你使用的宿主，以及是否允许联网或执行代码。来源的名气不能代替任务匹配。', en: 'Describe the input and expected output in one sentence, such as turning interview notes into findings with evidence references. Check the host and whether network or code execution is permitted. A familiar source does not guarantee a task fit.' } },
      { title: { zh: '从原始说明核对能力', en: 'Read the original description' }, body: { zh: '打开来源详情，阅读用途、原始链接、许可证和维护日期。黄页中的来源标签是编辑整理信息，不是对其中每个包的测试证明。外部仓库的实时状态和许可条款仍以原站为准。', en: 'Open a source detail page and inspect its purpose, original links, license and maintenance date. Directory labels are editorial metadata, not proof that every package was tested. Confirm current terms and repository status at the original source.' } },
      { title: { zh: '需要平台维护的版本时，看精品库', en: 'Use the curated library for platform-maintained releases' }, body: { zh: '精品详情对应具体版本。核对安全检查、人工实测摘要、宿主验证、权限和依赖。没有合格结果时可以继续研究外部来源，但不要把外部资源当作平台已经批准的安装包。', en: 'A curated detail page identifies an exact release. Review safety checks, the public test summary, host checks, permissions and dependencies. If no qualified release fits, research external sources without treating them as already approved packages.' } },
      { title: { zh: '在隔离项目里确认效果', en: 'Verify suitability in a separate project' }, body: { zh: '阅读边界和输入输出示例后，在不含生产密钥的测试项目尝试。记录适用和不适用的情况。人工测试说明能帮助选型，但不能保证在不同模型和任务中获得完全相同的结果。', en: 'After reviewing limitations and examples, try the release in a test project without production secrets. Record where it works and where it does not. A usage-test summary helps selection but cannot guarantee identical results across models and tasks.' } },
    ],
  },
  {
    slug: 'connect-a-project', updatedAt: '2026-09-06',
    title: { zh: '只接入一个 SkillFlux，如何按需获取能力？', en: 'How does one SkillFlux entry point load skills on demand?' },
    summary: { zh: 'npm 安装入口与本地 MCP，云端提供经过维护的内容；浏览器不负责修改你的项目。', en: 'npm installs the entry skill and local MCP. The cloud supplies maintained content; the browser does not edit your project.' },
    sourceCategories: [],
    sections: [
      { title: { zh: '安装的是入口，不是整座技能库', en: 'Install an entry point, not the whole library' }, body: { zh: '按接入页获取 npm 包，在目标项目中初始化。它提供显式调用的 SkillFlux 入口和本地 MCP 配置。具体精品包不会因为浏览网页或安装入口就全部进入项目。', en: 'Follow setup to obtain the npm package and initialize the target project. It provides an explicitly invoked entry skill and local MCP configuration. Browsing the website or installing the entry point does not download the entire curated library.' } },
      { title: { zh: '显式调用后再搜索', en: 'Search after an explicit invocation' }, body: { zh: '向宿主明确调用 SkillFlux，并用简短能力描述搜索。查询云端只需检索词；广告选择不需要原始任务、源码或完整回答。选择结果时阅读具体版本的证据与限制。', en: 'Explicitly invoke SkillFlux in your host with a short capability description. Cloud search needs the query; ad selection does not need the original task, source code or complete answer. Review the selected release and its limitations.' }, command: 'skillflux search "code review" --project .' },
      { title: { zh: '先看计划，再按授权安装', en: 'Inspect the plan, then install under local authorization' }, body: { zh: '安装计划固定具体版本和依赖，绑定当前项目。CLI/MCP 校验签名、权限、资格和撤销状态后才写入项目。普通安装授权不等于允许任意升级；后续升级有独立的固定目标计划。', en: 'An installation plan fixes releases and dependencies and is bound to the project. CLI/MCP checks signatures, permissions, qualifications and revocations before writing files. Initial installation authorization is not permission for arbitrary future upgrades.' } },
      { title: { zh: '按需加载，保持结果边界', en: 'Load only the needed context' }, body: { zh: '入口只请求所选 Skill 的主文件及需要的参考资源。网页不能保证第三方 AI 一定采用广告；原生 MCP 返回广告候选，受控 CLI 文本输出才负责在成功结果后追加披露。', en: 'The entry point requests the chosen skill and necessary reference resources. The website cannot force a third-party AI to include an ad. Native MCP returns a disclosed candidate; controlled CLI text output handles post-answer placement after successful output.' } },
    ],
  },
  {
    slug: 'maintain-project-skills', updatedAt: '2026-09-06',
    title: { zh: '项目里的 Skill 有更新，应该怎么办？', en: 'What should happen when an installed skill changes?' },
    summary: { zh: '先只读检查，再决定是否升级。区分云端 Skill 版本、npm 客户端版本和安全撤销。', en: 'Check first, then decide whether to upgrade. Distinguish cloud skill releases, npm client updates and security revocations.' },
    sourceCategories: [],
    sections: [
      { title: { zh: '检查不应该改变项目', en: 'Checking must not change the selected release' }, body: { zh: '只读更新检查比较项目锁与云端合格版本，返回当前版本、可用版本、变更摘要和兼容信息。普通结果可缓存 24 小时，主动检查可刷新；安全撤销独立检查。离线结果会明确标记未知或缓存时间。', en: 'A read-only update check compares the project lock with qualified cloud releases and reports versions, notes and compatibility. Ordinary results can be cached for 24 hours; explicit checks refresh them. Revocations are checked separately. Offline reports disclose unknown status or cache time.' }, command: 'skillflux check-updates --project .' },
      { title: { zh: '确认固定目标后升级', en: 'Approve an exact target before updating' }, body: { zh: '阅读变更和破坏性变更提示，选择一个确切目标版本。更新计划会记录这个目标，安装前再次验证。非交互命令需要明确确认参数，MCP 只执行指定计划，不能把“有新版”当成自动升级授权。', en: 'Review release notes and breaking changes, then choose an exact target. The plan fixes that target and verification runs again before installation. Non-interactive commands need explicit confirmation; MCP executes a specified plan rather than interpreting an available release as permission to update.' } },
      { title: { zh: '可复现项目可以固定版本', en: 'Pin releases for reproducible projects' }, body: { zh: '固定后仍可看到更新信息，但不能在普通升级中悄悄替换。需要升级时先主动解除固定。客户端保护用户修改的文件；失败不应损坏当前锁，回滚也只能选择仍然安全可用的版本。', en: 'Pinned releases still appear in update reports but cannot be silently replaced. Explicitly unpin before upgrading. The client preserves user edits, keeps the current lock on failure, and only rolls back to releases that remain safe and available.' } },
      { title: { zh: '更新提醒不等于离线推送', en: 'Update checks are not offline push notifications' }, body: { zh: '网站更新日志面向所有访客；本地 MCP 根据你的项目返回相关更新。应用没有运行时不会自行推送，宿主是否显示通知取决于其支持。云端 Skill 内容更新通常不要求重新安装 npm；需要新的客户端能力时才升级 npm 包。', en: 'Website release notes serve all visitors; local MCP reports changes relevant to the project. Nothing is pushed while the application is stopped, and notification display depends on host support. Cloud skill updates do not normally require reinstalling npm; client feature changes do.' } },
    ],
  },
];

export function getScenario(slug: string): Scenario | undefined { return scenarios.find(item => item.slug === slug); }
