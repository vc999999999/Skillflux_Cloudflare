import type { Language } from './i18n';
type Text = Record<Language, string>;
export type AgentEntry = { slug: string; name: string; summary: Text; guidance: Text[]; sourceSlugs: string[]; useCases: string[] };
export const agents: AgentEntry[] = [
  {
    slug: 'claude', name: 'Claude',
    summary: { zh: '从 Claude 相关的原始 Skill 仓库和发现入口开始，检查指令、工具与宿主要求，再选择适合具体任务的资源。', en: 'Explore Claude-related skill repositories and discovery sources. Review instructions, tool requirements and the intended host before choosing a resource for a particular task.' },
    guidance: [
      { zh: 'Anthropic Skills 提供阅读 Skill 组织方式的原始仓库；第三方合集则扩展了发现范围。两者的作者、许可证和维护方式需要分别核查。', en: 'The Anthropic Skills repository is a starting point for reading how skills are organized. Third-party collections widen the search, but authorship, licenses and maintenance need to be checked for each entry.' },
      { zh: 'Claude 网页、桌面应用与 Claude Code 的文件和工具接入方式并不相同。按你实际使用的产品阅读来源说明，确认当前环境能否运行其中的命令。', en: 'File and tool workflows differ across Claude products and Claude Code. Read the source instructions for the product you actually use and check whether the commands are available in that environment.' },
      { zh: 'SkillFlux 的本地安装流程通过项目 MCP 入口提供已审核版本。先查看安装指南，再从具体使用场景缩小候选范围；本页的外部来源清单不等于版本审核。', en: 'The local SkillFlux workflow exposes reviewed releases through a project MCP entry point. Follow the installation guide and narrow the shortlist by use case. Inclusion in this external source list is separate from release qualification.' }
    ],
    sourceSlugs: ['github-com-anthropics-skills', 'claude-plugins-dev', 'github-com-composiohq-awesome-claude-skills'], useCases: ['coding', 'writing', 'planning']
  },
  {
    slug: 'codex', name: 'Codex',
    summary: { zh: '为 Codex 项目查找开发工作流、任务规划与公开 Skill 来源，区分可阅读的指令与需要验证的运行依赖。', en: 'Research development workflows, task planning and public skill sources for a Codex project. Distinguish readable instructions from scripts and dependencies that require verification.' },
    guidance: [
      { zh: '先写清要改进的工作步骤，例如调试、测试或长任务计划，再阅读候选项目的原始文件。通用目录可以提供线索，但不会证明条目支持你的 Codex 版本。', en: 'Name the step you want to improve, such as debugging, testing or long-task planning, then inspect candidate source files. Broad catalogs provide leads; they do not establish support for the Codex version you use.' },
      { zh: '检查 Skill 是否依赖特定宿主命令、配置位置或外部服务。可迁移的文字说明与绑定宿主的工具调用应分开判断，不要仅凭资源名称认定兼容。', en: 'Check for host-specific commands, configuration paths and external services. Portable written guidance and host-dependent tool calls should be assessed separately; a resource name is not sufficient evidence of compatibility.' },
      { zh: '本项目提供 Codex 的 MCP 接入流程。阅读安装指南配置项目后，选择已公开的具体版本，并用已有测试检查运行结果。外部资源详情中的局限与替代方案可帮助你比较候选。', en: 'This project provides a Codex MCP setup workflow. Configure the project through the installation guide, choose an available exact release and use existing tests to evaluate the result. Resource limitations and alternatives help compare external candidates.' }
    ],
    sourceSlugs: ['github-com-obra-superpowers', 'github-com-othmanadi-planning-with-files', 'skills-sh'], useCases: ['coding', 'planning', 'discover-skills']
  },
  {
    slug: 'cursor', name: 'Cursor',
    summary: { zh: '围绕 Cursor 中的项目开发任务筛选 Skill 来源，检查规则格式、工具依赖和实际接入方式。', en: 'Find skill sources around project development tasks in Cursor, then check instruction formats, tool dependencies and the actual integration method.' },
    guidance: [
      { zh: '先区分项目规则、可复用 Skill 与 MCP 工具连接。它们解决的问题和配置方式不同；来源目录同时收录相关发现入口，并不代表它们可以互相替换。', en: 'Separate project rules, reusable skills and MCP tool connections. They serve different purposes and use different configuration methods. Discovery catalogs may cover all three without making them interchangeable.' },
      { zh: '开发清单适合建立候选范围，专门的计划项目适合查看文件如何保存任务上下文。回到每个项目原始文档，核对是否需要把特定宿主配置适配到当前工作区。', en: 'Development lists help form a shortlist, while focused planning projects show how files can preserve task context. Return to each original project to check whether host-specific configuration needs adaptation in the current workspace.' },
      { zh: '使用 SkillFlux 时，按安装指南配置 Cursor 的项目 MCP。接入成功与某个外部来源的兼容性是不同判断；只对实际发布且符合审核要求的版本提供安装流程。', en: 'For SkillFlux, configure the project MCP using the Cursor installation instructions. A working connection and compatibility of an external source are separate checks. The installation workflow applies to published releases that meet qualification requirements.' }
    ],
    sourceSlugs: ['github-com-voltagent-awesome-agent-skills', 'github-com-othmanadi-planning-with-files', 'skillsmp-com'], useCases: ['coding', 'planning', 'mcp']
  }
];
