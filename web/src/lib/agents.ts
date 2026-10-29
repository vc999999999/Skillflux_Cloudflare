import type { Language } from './i18n';
type Text = Record<Language, string>;
export type AgentEntry = { slug: string; name: string; summary: Text; guidance: Text[]; sourceSlugs: string[] };
export const agents: AgentEntry[] = [
  {
    slug: 'claude', name: 'Claude',
    summary: { zh: '从 Claude 相关的原始 Skill 仓库和发现入口开始，检查指令、工具与宿主要求，再选择适合具体任务的资源。', en: 'Explore Claude-related skill repositories and discovery sources. Review instructions, tool requirements and the intended host before choosing a resource for a particular task.' },
    guidance: [
      { zh: 'Anthropic Skills 提供阅读 Skill 组织方式的原始仓库；第三方合集则扩展了发现范围。两者的作者、许可证和维护方式需要分别核查。', en: 'The Anthropic Skills repository is a starting point for reading how skills are organized. Third-party collections widen the search, but authorship, licenses and maintenance need to be checked for each entry.' },
      { zh: 'Claude 网页、桌面应用与 Claude Code 的文件和工具接入方式并不相同。按你实际使用的产品阅读来源说明，确认当前环境能否运行其中的命令。', en: 'File and tool workflows differ across Claude products and Claude Code. Read the source instructions for the product you actually use and check whether the commands are available in that environment.' },
      { zh: '把候选 Skill 放进一个不含生产密钥的测试项目，用你自己的任务跑几次，再和不装 Skill 时的结果对比。只有对比才能说明它是否真的有帮助。', en: 'Put a candidate skill in a test project without production secrets, run your own task a few times, and compare against the same task without the skill. Only a comparison shows whether it actually helps.' }
    ],
    sourceSlugs: ['github-com-anthropics-skills', 'claude-plugins-dev', 'github-com-composiohq-awesome-claude-skills']
  },
  {
    slug: 'codex', name: 'Codex',
    summary: { zh: '为 Codex 项目查找开发工作流、任务规划与公开 Skill 来源，区分可阅读的指令与需要验证的运行依赖。', en: 'Research development workflows, task planning and public skill sources for a Codex project. Distinguish readable instructions from scripts and dependencies that require verification.' },
    guidance: [
      { zh: '先写清要改进的工作步骤，例如调试、测试或长任务计划，再阅读候选项目的原始文件。通用目录可以提供线索，但不会证明条目支持你的 Codex 版本。', en: 'Name the step you want to improve, such as debugging, testing or long-task planning, then inspect candidate source files. Broad catalogs provide leads; they do not establish support for the Codex version you use.' },
      { zh: '检查 Skill 是否依赖特定宿主命令、配置位置或外部服务。可迁移的文字说明与绑定宿主的工具调用应分开判断，不要仅凭资源名称认定兼容。', en: 'Check for host-specific commands, configuration paths and external services. Portable written guidance and host-dependent tool calls should be assessed separately; a resource name is not sufficient evidence of compatibility.' },
      { zh: '比较候选时，先看外部资源详情中的局限与替代方案，再在测试分支里用已有测试检查运行结果。模型和宿主版本变化可能改变效果，记录你测试时的版本。', en: 'When comparing candidates, start from the limitations and alternatives on each resource page, then evaluate results on a test branch with your existing tests. Model and host versions can change outcomes, so record the versions you tested.' }
    ],
    sourceSlugs: ['github-com-obra-superpowers', 'github-com-othmanadi-planning-with-files', 'skills-sh']
  },
  {
    slug: 'cursor', name: 'Cursor',
    summary: { zh: '围绕 Cursor 中的项目开发任务筛选 Skill 来源，检查规则格式、工具依赖和实际接入方式。', en: 'Find skill sources around project development tasks in Cursor, then check instruction formats, tool dependencies and the actual integration method.' },
    guidance: [
      { zh: '先区分项目规则、可复用 Skill 与 MCP 工具连接。它们解决的问题和配置方式不同；来源目录同时收录相关发现入口，并不代表它们可以互相替换。', en: 'Separate project rules, reusable skills and MCP tool connections. They serve different purposes and use different configuration methods. Discovery catalogs may cover all three without making them interchangeable.' },
      { zh: '开发清单适合建立候选范围，专门的计划项目适合查看文件如何保存任务上下文。回到每个项目原始文档，核对是否需要把特定宿主配置适配到当前工作区。', en: 'Development lists help form a shortlist, while focused planning projects show how files can preserve task context. Return to each original project to check whether host-specific configuration needs adaptation in the current workspace.' },
      { zh: 'Cursor 能否加载某个 Skill 与这个 Skill 是否改善结果是两个问题。先确认加载方式，再用固定任务比较有无该 Skill 的差异。', en: 'Whether Cursor can load a skill and whether that skill improves results are separate questions. Confirm how it loads first, then compare a fixed task with and without the skill.' }
    ],
    sourceSlugs: ['github-com-voltagent-awesome-agent-skills', 'github-com-othmanadi-planning-with-files', 'skillsmp-com']
  }
];
