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
    slug: 'connect-a-project', updatedAt: '2026-10-09',
    title: { zh: '只接入一个 SkillFlux，如何按需获取能力？', en: 'How does one SkillFlux entry point load skills on demand?' },
    summary: { zh: 'npm 安装本地工具，init 配置项目入口；MCP 从 GitHub 获取完整发布包，加载后交给宿主 AI 使用。', en: 'npm installs the local tools and init configures the project entry point. MCP fetches complete releases from GitHub, then loads their instructions for the host AI.' },
    sourceCategories: [],
    sections: [
      { title: { zh: '安装工具并初始化项目', en: 'Install the tools and initialize the project' }, body: { zh: '按接入页安装 @skillflux/mcp，再在目标项目运行 init，生成显式调用的 SkillFlux 入口和本地 MCP 配置。若要让 MCP 安装已审核文本包，需要在 init 时显式加入 --preauthorize-reviewed-text；未开启时，可由用户运行 CLI 安装。初始化不会下载整座技能库。', en: 'Install @skillflux/mcp using the setup guide, then run init in the target project to create the explicit SkillFlux entry point and local MCP configuration. MCP installation of reviewed text packages requires explicitly passing --preauthorize-reviewed-text during init. Without it, the user can install through the CLI. Initialization does not download the entire skill library.' } },
      { title: { zh: '显式调用后再搜索', en: 'Search after an explicit invocation' }, body: { zh: '向宿主明确调用 SkillFlux，并用简短能力描述搜索。搜索在本机缓存的 GitHub 目录索引上进行，检索词不会离开你的机器。结果只包含符合当前安装资格的版本；来源页收录或保存完整候选包，不代表已经可以通过 MCP 安装。', en: 'Explicitly invoke SkillFlux in your host with a short capability description. Search runs locally over the cached GitHub catalog index; queries never leave your machine. Results contain releases eligible for installation. A source listing or a collected complete candidate package does not establish MCP installation eligibility.' }, command: 'skillflux search "grill-me" --project .' },
      { title: { zh: '按计划下载完整发布包', en: 'Download complete releases from the plan' }, body: { zh: 'plan 固定具体版本和依赖，绑定当前项目；install 从固定的 GitHub 提交下载这些发布包的全部声明文件，包括入口、参考资料、宿主配置和许可证。客户端逐文件核对哈希，并检查权限、资格和撤销状态，再写入项目。只下载本次计划中的包。', en: 'plan fixes versions and dependencies for the current project. install downloads every declared file in those releases from a pinned GitHub commit, including entry instructions, references, host metadata and licenses. The client verifies file hashes, permissions, eligibility and revocations before writing the packages to the project. Only packages in the plan are downloaded.' } },
      { title: { zh: '加载指令，由宿主 AI 执行', en: 'Load the instructions for the host AI' }, body: { zh: 'load 重新校验已安装文件，返回所选 Skill 的入口、依赖正文及本次需要的参考资源。完整包保存在本地，AI 按需读取；宿主 AI 再根据这些指令完成任务，SkillFlux 本身不运行技能脚本。已开启自动跟随时，load 会先检查并应用符合条件的更新；离线时会说明最新状态未知。', en: 'load re-verifies installed files and returns the selected entry, dependency instructions and requested reference resources. Complete packages remain local while the AI reads what it needs. The host AI then performs the task using those instructions; SkillFlux does not run skill scripts. When automatic following is enabled, load first checks and applies eligible updates. Offline results disclose that current catalog status is unknown.' } },
    ],
  },
  {
    slug: 'maintain-project-skills', updatedAt: '2026-10-09',
    title: { zh: '项目里的 Skill 有更新，应该怎么办？', en: 'What should happen when an installed skill changes?' },
    summary: { zh: '可选择手动更新，或开启加载时自动跟随兼容版本。GitHub 中的 Skill 内容与 npm 客户端分别更新。', en: 'Choose manual updates or opt into following compatible releases when loading a skill. GitHub skill content and the npm client update separately.' },
    sourceCategories: [],
    sections: [
      { title: { zh: '检查状态，不替换已安装版本', en: 'Check status without replacing installed versions' }, body: { zh: 'check-updates 比较项目锁与目录仓库中的合格版本，返回当前版本、可用版本、变更摘要和兼容信息，不安装更新。普通结果可缓存 24 小时，主动检查可刷新；离线结果会明确标记未知或缓存时间。', en: 'check-updates compares the project lock with qualified catalog releases and reports versions, notes and compatibility without installing updates. Ordinary results can be cached for 24 hours; explicit checks refresh them. Offline reports disclose unknown status or cache time.' }, command: 'skillflux check-updates --project .' },
      { title: { zh: '需要自动跟随时，由用户开启', en: 'Opt into automatic following when needed' }, body: { zh: '用户可在 init 时选择 --update-policy follow-compatible，或在本地运行下方命令。开启后，每次 load 会检查 GitHub 目录，并在返回内容前更新到已审核、稳定、兼容的版本。固定版本、本地修改和破坏性变更会阻止自动替换。它不会在后台定时运行，也不会更新 npm 工具。', en: 'The user can select --update-policy follow-compatible during init or run the local command below. Each subsequent load checks the GitHub catalog and applies reviewed, stable, compatible releases before returning content. Pins, local edits and breaking changes prevent automatic replacement. This does not run on a background schedule or update the npm tools.' }, command: 'skillflux update-policy follow-compatible --project .' },
      { title: { zh: '手动升级时确认具体目标', en: 'Approve an exact target for manual updates' }, body: { zh: '未开启自动跟随，或需要手动选择版本时，先阅读变更和破坏性变更提示，再确认确切目标。更新计划固定目标并在安装前再次验证。非交互 CLI 需要明确确认参数，MCP 的 update 只执行用户批准的指定计划；初次安装授权不包含任意升级。', en: 'When following is disabled or a version must be chosen manually, review release notes and breaking changes before approving an exact target. The plan fixes that target and verification runs again before installation. Non-interactive CLI updates need explicit confirmation; MCP update executes the specified user-approved plan. Initial installation authorization does not permit arbitrary upgrades.' } },
      { title: { zh: '可复现项目可以固定版本', en: 'Pin releases for reproducible projects' }, body: { zh: '固定后仍可看到更新信息，但不能在普通升级中悄悄替换。需要升级时先主动解除固定。客户端保护用户修改的文件；失败不应损坏当前锁，回滚也只能选择仍然安全可用的版本。', en: 'Pinned releases still appear in update reports but cannot be silently replaced. Explicitly unpin before upgrading. The client preserves user edits, keeps the current lock on failure, and only rolls back to releases that remain safe and available.' } },
      { title: { zh: '更新提醒不等于离线推送', en: 'Update checks are not offline push notifications' }, body: { zh: '网站更新日志面向所有访客；本地 MCP 根据你的项目返回相关更新。应用没有运行时不会自行推送，宿主是否显示通知取决于其支持。目录仓库中的 Skill 内容更新通常不要求重新安装 npm；需要新的客户端能力时才升级 npm 包。', en: 'Website release notes serve all visitors; local MCP reports changes relevant to the project. Nothing is pushed while the application is stopped, and notification display depends on host support. Catalog skill updates do not normally require reinstalling npm; client feature changes do.' } },
    ],
  },
];

export function getScenario(slug: string): Scenario | undefined { return scenarios.find(item => item.slug === slug); }
