import { getSites, type Site } from './content';
import { collectionDetails, useCaseDetails, type EditorialDetails } from './editorial-copy';

export type EditorialText = { zh: string; en: string };
export type EditorialEntry = {
  slug: string;
  icon: string;
  title: EditorialText;
  summary: EditorialText;
  siteSlugs: string[];
  updatedAt: string;
  details: EditorialDetails;
};
export type UseCase = EditorialEntry & { steps: EditorialText[] };
export type CuratedCollection = EditorialEntry & { kicker: EditorialText };

// Editorial groupings describe discovery paths, not verified compatibility or install approval.
export const useCases: UseCase[] = [
  {
    slug: 'coding', icon: 'code', title: { zh: '编程与开发', en: 'Coding & development' },
    summary: { zh: '从需求拆解、调试到测试，找到适合开发工作流的 Skill 来源。', en: 'Explore skill sources for planning, debugging, testing and everyday development.' },
    siteSlugs: ['github-com-obra-superpowers', 'github-com-anthropics-skills', 'atcyrus-com-skills', 'github-com-xu-xiang-everything-claude-code-zh'],
    steps: [
      { zh: '先明确任务：需求规划、调试还是测试，避免一次引入整套配置。', en: 'Choose a concrete task: planning, debugging or testing. Start with the relevant part of a workflow.' },
      { zh: '阅读仓库中的 Skill 主文件，检查命令、依赖与当前项目是否匹配。', en: 'Read the skill instructions and check commands and dependencies against your project.' },
      { zh: '在可回滚的项目中试用，用现有测试验证实际输出。', en: 'Try it in a project you can restore, and validate the output with existing tests.' },
    ],
  },
  {
    slug: 'mobile', icon: 'mobile', title: { zh: '移动应用开发', en: 'Mobile development' },
    summary: { zh: '从 Android 与 Expo 团队的公开仓库，探索原生与跨平台开发能力。', en: 'Explore native and cross-platform workflows through Android and Expo team repositories.' },
    siteSlugs: ['github-com-android-skills', 'github-com-expo-skills', 'github-com-voltagent-awesome-agent-skills'],
    steps: [
      { zh: '先确定 Android 原生或 React Native / Expo 技术栈。', en: 'Identify whether your project uses native Android or React Native / Expo.' },
      { zh: '查看来源文档中的框架版本、工具链与项目要求。', en: 'Check the source documentation for framework versions, tooling and project requirements.' },
      { zh: '在模拟器或真机上验证生成的界面和交互。', en: 'Verify generated interfaces and interactions on a simulator or physical device.' },
    ],
  },
  {
    slug: 'writing', icon: 'pen', title: { zh: '内容与写作', en: 'Content & writing' },
    summary: { zh: '改善中文表达，探索写作与文档相关的社区 Skill。', en: 'Refine Chinese prose and discover community skills for writing and documents.' },
    siteSlugs: ['github-com-op7418-humanizer-zh', 'github-com-laolaoshiren-claude-code-skills-zh', 'github-com-composiohq-awesome-claude-skills'],
    steps: [
      { zh: '准备一小段原稿，明确读者、语气和必须保留的事实。', en: 'Prepare a short draft, its audience, desired tone and facts that must remain unchanged.' },
      { zh: '选择与语言和文体匹配的 Skill，并先阅读处理规则。', en: 'Choose a skill that fits the language and format, and read its editing rules.' },
      { zh: '逐段复核表达与事实，让最终文字保留你的判断。', en: 'Review wording and facts paragraph by paragraph, keeping your own editorial judgment.' },
    ],
  },
  {
    slug: 'video', icon: 'play', title: { zh: '视频与媒体', en: 'Video & media' },
    summary: { zh: '寻找视频理解、下载发布与媒体处理方向的开源项目。', en: 'Find open-source projects for video understanding and media workflows.' },
    siteSlugs: ['github-com-bradautomates-claude-video', 'github-com-wlzh-skills', 'github-com-composiohq-awesome-claude-skills'],
    steps: [
      { zh: '明确需要的是视频理解、素材处理还是发布流程。', en: 'Decide whether the task is understanding video, processing media or preparing publication.' },
      { zh: '检查输入格式、外部服务和工具依赖，使用有权处理的素材。', en: 'Check accepted formats, services and tool dependencies, and use media you are allowed to process.' },
      { zh: '先用短素材验证字幕、摘要或导出结果，再处理完整内容。', en: 'Validate captions, summaries or exports on a short sample before processing the full asset.' },
    ],
  },
  {
    slug: 'planning', icon: 'plan', title: { zh: '长任务与规划', en: 'Planning & long tasks' },
    summary: { zh: '把目标、进度和上下文保存在文件里，让多步骤任务更容易接续。', en: 'Keep goals, progress and context in files so multi-step tasks are easier to resume.' },
    siteSlugs: ['github-com-othmanadi-planning-with-files', 'github-com-obra-superpowers', 'github-com-xu-xiang-everything-claude-code-zh'],
    steps: [
      { zh: '写清目标、范围和验收标准，再拆分可验证的小步骤。', en: 'Write the goal, scope and acceptance criteria before splitting work into verifiable steps.' },
      { zh: '将关键决策与当前进度保存在项目内的计划文件。', en: 'Save key decisions and current progress in project planning files.' },
      { zh: '恢复任务时先阅读计划，再用实际产物更新完成状态。', en: 'Read the plan when resuming and update completion status from actual results.' },
    ],
  },
  {
    slug: 'security', icon: 'shield', title: { zh: '安全与审查', en: 'Security & review' },
    summary: { zh: '从安全向清单和开发市场发现候选工具，建立自己的核查流程。', en: 'Discover candidates in security-focused lists and developer marketplaces for your review workflow.' },
    siteSlugs: ['github-com-behisecc-awesome-claude-skills', 'atcyrus-com-skills', 'github-com-obra-superpowers'],
    steps: [
      { zh: '先界定需要审查的代码、依赖或配置及授权范围。', en: 'Define the code, dependencies or configuration to review and the authorized scope.' },
      { zh: '检查 Skill 的脚本、网络调用、权限和来源记录。', en: 'Inspect the skill scripts, network calls, permissions and provenance.' },
      { zh: '将结果当作待验证的线索，复现问题后再决定修复。', en: 'Treat results as findings to verify; reproduce issues before choosing a fix.' },
    ],
  },
  {
    slug: 'discover-skills', icon: 'search', title: { zh: '发现合适的 Skill', en: 'Find the right skill' },
    summary: { zh: '比较官方平台、社区目录与精选清单，从任务出发缩小选择范围。', en: 'Compare official platforms, community directories and curated lists to narrow the search around your task.' },
    siteSlugs: ['modelscope-cn-skills', 'skills-sh', 'skillsmp-com', 'qoder-community-pages-dev-zh-skills', 'github-com-voltagent-awesome-agent-skills'],
    steps: [
      { zh: '用一句话描述能力需求，并列出语言和运行环境限制。', en: 'Describe the capability in one sentence, including language and environment constraints.' },
      { zh: '对比多个来源，回到原始仓库阅读说明、许可证与依赖。', en: 'Compare sources, then read the original repository instructions, license and dependencies.' },
      { zh: '需要通过 SkillFlux 安装时，到精品 Registry 查看实际可用版本。', en: 'For installation through SkillFlux, check the curated Registry for available releases.' },
    ],
  },
  {
    slug: 'mcp', icon: 'plug', title: { zh: '连接工具与 MCP', en: 'Tools & MCP' },
    summary: { zh: '探索 MCP 服务器目录，了解外部工具如何接入你的 AI 工作环境。', en: 'Explore MCP server directories and learn how external tools connect to your AI environment.' },
    siteSlugs: ['mcpservers-org', 'mcpmarket-com-zh-tools-skills-leaderboard', 'github-com-xu-xiang-everything-claude-code-zh'],
    steps: [
      { zh: '先确认需要连接的服务，以及宿主是否支持相应 MCP 接入方式。', en: 'Identify the service you need and whether your host supports its MCP connection method.' },
      { zh: '阅读服务器原始说明，核对认证方式、数据流向和权限。', en: 'Read the server documentation and check authentication, data flow and permissions.' },
      { zh: '依照来源文档配置并验证；目录收录不代表可用 SkillFlux 一键安装。', en: 'Configure and verify it using the source documentation; directory inclusion does not imply one-command SkillFlux installation.' },
    ],
  },
].map(entry => ({ ...entry, updatedAt: '2026-09-29', details: useCaseDetails[entry.slug] }));

export const collections: CuratedCollection[] = [
  { slug: 'official-start', icon: 'compass', kicker: { zh: '从这里开始', en: 'START HERE' }, title: { zh: '先看官方来源', en: 'Start with official sources' }, summary: { zh: '从厂商平台与公开仓库了解 Skill 的组织方式，再选择适合自己的入口。', en: 'Learn how skills are organized through vendor platforms and public repositories, then choose your starting point.' }, siteSlugs: ['modelscope-cn-skills', 'github-com-anthropics-skills', 'skills-aliyun-com-skills-orderby-install', 'skillhub-cn-dashboard', 'hermes-agent-nousresearch-com-docs-zh-hans-skills'] },
  { slug: 'chinese-workflows', icon: 'pen', kicker: { zh: '中文优先', en: 'CHINESE FIRST' }, title: { zh: '中文使用者工具箱', en: 'A toolkit for Chinese users' }, summary: { zh: '汇集中文目录、写作工具与社区配置，降低阅读和查找成本。', en: 'Chinese directories, writing tools and community configurations that make discovery easier.' }, siteSlugs: ['modelscope-cn-skills', 'github-com-op7418-humanizer-zh', 'github-com-xu-xiang-everything-claude-code-zh', 'github-com-laolaoshiren-claude-code-skills-zh', 'qoder-community-pages-dev-zh-skills', 'skills-pub-zh'] },
  { slug: 'developer-workbench', icon: 'code', kicker: { zh: '开发工作流', en: 'DEVELOPER WORKFLOWS' }, title: { zh: '开发者的工作台', en: 'The developer workbench' }, summary: { zh: '围绕任务规划、调试、测试和移动开发组织的来源清单。', en: 'Sources for task planning, debugging, testing and mobile development.' }, siteSlugs: ['github-com-obra-superpowers', 'github-com-othmanadi-planning-with-files', 'github-com-android-skills', 'github-com-expo-skills', 'atcyrus-com-skills'] },
  { slug: 'creative-workflows', icon: 'play', kicker: { zh: '内容创作', en: 'CREATIVE WORKFLOWS' }, title: { zh: '从文字到视频', en: 'From words to video' }, summary: { zh: '探索中文润色、视频理解和媒体处理的专门项目与相关清单。', en: 'Explore focused projects and discovery lists for prose editing, video understanding and media processing.' }, siteSlugs: ['github-com-op7418-humanizer-zh', 'github-com-bradautomates-claude-video', 'github-com-wlzh-skills', 'github-com-composiohq-awesome-claude-skills'] },
  { slug: 'community-picks', icon: 'grid', kicker: { zh: '拓展视野', en: 'EXPLORE MORE' }, title: { zh: '社区的发现路径', en: 'Community discovery paths' }, summary: { zh: '从大型目录与 awesome 清单出发，继续追溯每项资源的原始来源。', en: 'Start with broad directories and awesome lists, then trace each resource back to its original source.' }, siteSlugs: ['skills-sh', 'skillsmp-com', 'github-com-voltagent-awesome-agent-skills', 'github-com-travisvn-awesome-claude-skills', 'lobehub-com-skills', 'skill0-io'] },
  { slug: 'mcp-essentials', icon: 'plug', kicker: { zh: '连接更多能力', en: 'CONNECT YOUR TOOLS' }, title: { zh: 'MCP 探索起点', en: 'A starting point for MCP' }, summary: { zh: '区分 Skill 指令与 MCP 工具连接，从服务器目录和配置示例开始了解。', en: 'Distinguish skill instructions from MCP tool connections through server directories and configuration examples.' }, siteSlugs: ['mcpservers-org', 'mcpmarket-com-zh-tools-skills-leaderboard', 'github-com-xu-xiang-everything-claude-code-zh'] },
].map(entry => ({ ...entry, updatedAt: '2026-09-29', details: collectionDetails[entry.slug] }));

export function getEditorialSites(entry: Pick<EditorialEntry, 'siteSlugs'>): Site[] {
  const bySlug = new Map(getSites().map(site => [site.slug, site]));
  return entry.siteSlugs.map(slug => {
    const site = bySlug.get(slug);
    if (!site) throw new Error(`Unknown editorial source: ${slug}`);
    return site;
  });
}
export function getUseCase(slug: string): UseCase | undefined { return useCases.find(entry => entry.slug === slug); }
export function getCollection(slug: string): CuratedCollection | undefined { return collections.find(entry => entry.slug === slug); }
export function getSiteUseCases(slug: string): UseCase[] { return useCases.filter(entry => entry.siteSlugs.includes(slug)); }
export function getRecommendationReason(site: Site, lang: 'zh' | 'en'): string {
  const cases = getSiteUseCases(site.slug).slice(0, 2).map(entry => entry.title[lang]);
  if (cases.length) return lang === 'zh' ? `适合从「${cases.join('」「')}」任务开始探索。` : `A source to explore for ${cases.join(' and ').toLowerCase()}.`;
  return lang === 'zh' ? '查看来源说明、原始链接与相关资源，再判断是否适合你的任务。' : 'Compare source details, original links and related resources against your task.';
}
