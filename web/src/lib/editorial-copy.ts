// Editorial comparisons are grounded in catalog descriptions, not compatibility tests.
type Copy = { zh: string; en: string };
export type EditorialDetails = {
  overview: Copy[];
  audience: Copy;
  selection: Copy;
  comparisons: { siteSlug: string; role: Copy; tradeoff: Copy }[];
  relatedGuides: string[];
};
const t = (zh: string, en: string): Copy => ({ zh, en });
const row = (siteSlug: string, role: Copy, tradeoff: Copy) => ({ siteSlug, role, tradeoff });
const sourceGuide = 'choosing-a-skill-source';
const downloadGuide = 'how-to-download-claude-skills';

export const useCaseDetails: Record<string, EditorialDetails> = {
  coding: {
    overview: [
      t('为编程任务选 Skill，首先要区分你缺的是开发方法、某项具体能力，还是整个工作环境的配置。调试一个已有问题时，最有价值的输入是可复现步骤、预期行为和现有测试；开始新功能时，则需要明确范围、接口和验收结果。把这些准备好，再选择能补上当前缺口的来源，比按清单长度挑选更容易判断效果。', 'Choosing skills for coding starts with the gap in your development process. A debugging task needs a reproducible failure, an expected result and a way to verify the fix. A new feature needs a bounded requirement and acceptance criteria. A skill can help structure those activities, but the useful choice depends on which activity is missing. Keep the project’s existing conventions and tests visible when comparing candidates.'),
      t('这份清单刻意保留四种不同入口：Superpowers 展示规划、调试和测试等开发流程；anthropics/skills 提供可阅读的官方 Skill 实现；Cyrus 用市场分类帮助查找具体开发能力；everything-claude-code 中文版则把 Skill 与 agents、hooks、commands 等配置放在一起。它们的差别是工作流层级，而不是一份可以直接互换的产品排名。', 'The shortlist separates workflow structure from source examples and discovery. Superpowers describes a development methodology spanning planning, debugging and testing. The Anthropic repository provides first-party skill implementations to inspect. Cyrus offers a marketplace route into development categories. The Chinese everything-claude-code project combines skills with other configuration elements. These are different layers of a development environment, so comparing the number of entries would miss the main decision.'),
      t('第一次接入可以只选择一个重复出现的任务，例如为已知 bug 增加回归测试。记录引入前后需要人工返工的部分，检查实际 diff，再决定是否采用更多流程。不要把某个仓库展示了 Claude Code 示例理解成所有宿主、语言和构建系统都已验证；每项能力的依赖和触发方式仍需要回到原始说明确认。', 'For a first trial, choose one recurring task, such as adding a regression test for a known bug. Compare the resulting diff with your normal review standard and record where manual corrections were needed. A useful outcome is a clearer, verifiable change, rather than a larger set of installed instructions. Expand the workflow only after that small trial. Host support, commands and project dependencies must still be checked in each selected skill’s original documentation.'),
    ],
    audience: t('适合已有代码仓库、希望改善规划、调试或测试流程的开发者；初次接入时应有人能够审查代码结果。', 'Developers working in an existing repository who can review code and want to improve planning, debugging or testing.'),
    selection: t('需要成套开发方法时先读 Superpowers；想研究 Skill 写法时看 Anthropic 仓库；按具体任务寻找候选项时浏览 Cyrus；需要中文配置参考时读 everything-claude-code。先选与当前缺口对应的一层。', 'Start with Superpowers for a development method, Anthropic for implementation examples, Cyrus for task discovery, or everything-claude-code for Chinese configuration references. Choose the layer that matches the current gap.'),
    comparisons: [
      row('github-com-obra-superpowers', t('规划、调试和测试工作流。', 'Planning, debugging and testing workflows.'), t('流程框架涉及多项约定，应先理解触发条件再用于项目。', 'A workflow framework introduces conventions; inspect how its instructions are triggered.')),
      row('github-com-anthropics-skills', t('官方 Skill 实现与组织方式参考。', 'First-party skill implementations and structure.'), t('逐项选择相关内容，官方来源不等于与你的项目自动匹配。', 'Select relevant examples; first-party origin does not establish fit for your project.')),
      row('atcyrus-com-skills', t('按开发任务浏览的市场入口。', 'A marketplace organized around developer tasks.'), t('各项来源、依赖和服务条件需要分别确认。', 'Check the source, dependencies and service terms of each item.')),
      row('github-com-xu-xiang-everything-claude-code-zh', t('中文 Claude Code 配置学习材料。', 'Chinese reference material for Claude Code configuration.'), t('包含 Skill 以外的配置，复制前区分各部分作用。', 'Separate skills from hooks, agents and other configuration before adopting them.')),
    ],
    relatedGuides: [sourceGuide, downloadGuide],
  },
  mobile: {
    overview: [
      t('移动开发场景的第一道筛选条件是现有技术栈。原生 Android 与 React Native / Expo 的工程结构、依赖和调试方式不同，同样叫作“页面开发”的任务也可能需要完全不同的步骤。因此先记录项目框架、构建方式和待解决的问题，再阅读对应团队的 Skill，能减少把不适用的建议带进项目的机会。', 'The first filter for mobile development is the project’s existing stack. Native Android and React Native with Expo have different project structures, dependencies and debugging workflows. A request to build a screen can therefore require very different instructions. Write down the framework, build process and concrete task before choosing a source. The useful starting point is the one whose assumptions match the application you actually need to change.'),
      t('Android Skills 与 Expo Skills 分别提供面向各自生态的公开仓库，适合直接查看具体指令；VoltAgent 的 awesome-agent-skills 则是跨来源发现清单，适合在已经确定框架之后继续寻找周边能力。这里没有把三者视为三个等价的安装包：前两个帮助缩小到平台范围，第三个帮助扩大候选来源。', 'Android Skills and Expo Skills are public repositories associated with their respective development ecosystems. They give you specific instructions to inspect. The VoltAgent awesome list serves a different purpose: it is a discovery path across sources, useful when the platform-specific repository does not cover the task you have identified. This distinction keeps a broad list from being mistaken for a single mobile development package with uniform requirements.'),
      t('实际验证应覆盖运行结果，而不仅是代码能否生成。可以选取一个有限的界面或状态变化作为样本，检查构建是否成功，再在模拟器或真机上观察导航、输入和错误状态。涉及原生依赖、设备权限或发布配置时，需要逐项核对仓库说明；本页的收录没有代表任何框架版本组合已通过兼容性测试。', 'A practical evaluation should include application behavior, not only generated source code. Pick a small screen or state transition, run the project’s build and inspect it on a simulator or device. Check navigation, input handling and error states against the original requirement. When a task touches native dependencies, device permissions or release configuration, review those details separately. Inclusion in this shortlist does not establish support for a particular framework version or device combination.'),
    ],
    audience: t('适合原生 Android 或 React Native / Expo 项目的维护者，以及需要先按平台筛选资源的移动开发团队。', 'Maintainers of native Android or React Native / Expo applications who need a platform-specific starting point.'),
    selection: t('原生 Android 从 Android Skills 开始；Expo 项目先看 Expo Skills。只有具体任务在对应仓库中没有合适入口时，再用 VoltAgent 清单扩展搜索，并逐项核对目标框架。', 'Use Android Skills for native Android and Expo Skills for an Expo project. Expand through the VoltAgent list when a specific gap remains, checking the target framework of each candidate.'),
    comparisons: [
      row('github-com-android-skills', t('原生 Android 开发入口。', 'A starting point for native Android development.'), t('面向 Android；项目版本和工具链仍需核对。', 'Android-focused; verify project versions and tooling.')),
      row('github-com-expo-skills', t('React Native / Expo 开发生态。', 'React Native / Expo development workflows.'), t('不要默认其中的项目约定适用于所有原生应用。', 'Do not assume its project conventions apply to every native application.')),
      row('github-com-voltagent-awesome-agent-skills', t('寻找跨来源的补充能力。', 'Discovery of additional capabilities across sources.'), t('是发现清单，具体移动开发能力由链接的原项目提供。', 'A discovery list; individual linked projects provide the mobile capabilities.')),
    ],
    relatedGuides: [sourceGuide, downloadGuide],
  },
  writing: {
    overview: [
      t('写作任务应从原稿和编辑目标开始，而不是先安装一个“万能写作”合集。中文润色、结构调整和文档整理需要不同的规则。准备一段能代表实际难度的文字，注明读者、需要保留的术语以及不可改变的事实，就能更清楚地比较候选 Skill 在哪些地方帮助了你，哪些改动需要撤回。', 'Start a writing workflow with a draft and an editorial goal. Improving Chinese prose, restructuring an argument and organizing a document are different tasks, even when they all involve text. Prepare a representative passage and identify its audience, required terminology and facts that must remain intact. That sample gives you something concrete to compare instead of choosing a source because it promises a broadly better writing style.'),
      t('Humanizer-zh 专注中文表达，适合已有初稿、希望检查措辞和语气的情况。claude-code-skills-zh 提供中文社区的分类与说明，可以继续寻找其他写作或文档方向的候选项。Composio 的 awesome 清单则提供另一条跨主题发现路径。后两者作为合集的价值是帮助查找，不能据此推断每一条目都支持相同语言或文件格式。', 'Humanizer-zh is the focused option in this shortlist: its catalog description concerns making Chinese AI-generated prose sound more natural. The Chinese claude-code-skills collection offers explanations and categorized discovery for users who prefer Chinese material. Composio’s awesome list offers another route across skill topics. The latter two are collections, so their role is to help locate an individual writing or document skill whose actual instructions you can then examine.'),
      t('评价输出时要同时检查表达和内容。语句更顺并不代表事实更准确，删掉看似重复的限定词也可能改变原意。保留原稿，按段落审阅修改，尤其留意数字、引用和专业术语。完成一小段试用后再处理全文，并把自己的语气要求写清楚；本页的选择理由是编辑用途，不是自动通过事实核查或其他检测的保证。', 'Evaluate both expression and meaning. A smoother sentence can still change a claim, remove an important qualification or introduce an unsupported detail. Keep the original text and review edits paragraph by paragraph, with particular attention to numbers, quotations and specialist terms. Once the short sample meets your standard, apply the same brief to a longer document. The selection here is about editorial use; it does not promise factual verification or a particular result from any automated detector.'),
    ],
    audience: t('适合需要润色中文初稿的作者，以及愿意逐段复核结果的内容、文档维护者。', 'Authors refining Chinese drafts and document editors who will review the resulting changes.'),
    selection: t('只需要中文表达润色时先看 Humanizer-zh；需要更多文体或文档流程时，利用中文合集与 Composio 清单找到具体条目，再阅读其输入格式和编辑规则。', 'Choose Humanizer-zh for Chinese prose editing. For another format or document workflow, use the Chinese collection or Composio list to find a specific skill and inspect its input and editing rules.'),
    comparisons: [
      row('github-com-op7418-humanizer-zh', t('中文表达润色的专门项目。', 'A focused project for refining Chinese prose.'), t('改善表达不等于事实核查，原意仍需作者复核。', 'Style editing does not replace fact checking or review of meaning.')),
      row('github-com-laolaoshiren-claude-code-skills-zh', t('通过中文说明寻找相关 Skill。', 'Discover related skills through Chinese explanations.'), t('需要继续挑选具体条目，并确认文件格式要求。', 'Select an individual entry and verify its file-format requirements.')),
      row('github-com-composiohq-awesome-claude-skills', t('跨主题写作与文档能力的发现入口。', 'A discovery route across writing and document topics.'), t('合集不能作为每个条目语言支持或质量的保证。', 'Collection membership does not establish language support or quality.')),
    ],
    relatedGuides: [sourceGuide, downloadGuide],
  },
  video: {
    overview: [
      t('视频与媒体工作流需要先确定输出：理解已有视频、处理素材，还是准备发布。三者对输入、工具和验收方式的要求不同。一个有效的任务描述应包括素材类型、期望结果和需要保留的信息，例如为一段访谈整理摘要，或把一份已有素材交给后续处理步骤。先定义结果，才能判断某项 Skill 是否处于正确的环节。', 'Begin a video or media workflow by defining the output. Understanding an existing video, processing an asset and preparing publication are distinct jobs. They can require different inputs, tools and acceptance checks. A useful brief names the material, the desired result and the information that must survive the process. Summarizing an interview, for example, should be evaluated differently from preparing a media file for a later production step.'),
      t('claude-video 的收录主题是视频理解与处理，适合围绕单一视频任务阅读实现。wlzh/skills 是个人维护的中文合集，包含视频下载发布等实用方向，适合寻找具体处理环节。Composio 的 awesome 清单提供更广的发现范围。把专门项目、作者工具箱和综合清单放在一起，是为了比较发现路径，并不意味着三者能组成已经联调过的视频流水线。', 'The catalog positions claude-video as a focused project for video-related understanding and processing. The Chinese wlzh collection includes practical media tasks such as downloading and publishing video. Composio’s awesome list provides a broader discovery route when the task extends beyond those projects. They are included for these different entry points, rather than as a preconfigured production pipeline. Any handoff between separate tools needs its own format and dependency checks.'),
      t('可以先使用一段短素材试跑，把结果与原始片段逐项对照。若任务要求摘要，就检查是否遗漏关键事实；若要求文件处理，就检查输出能否被下一步工具打开。原始说明中的格式、时长限制和外部服务要求需要单独确认。保留原始素材及参数，让完整处理出现问题时可以回溯到某个步骤，而不是重复整条流程。', 'Use a short representative asset for the first trial and compare the output with the original. For a summary, check whether the important statements are preserved. For file processing, check whether the next tool can open the result. Read the selected project’s documentation for supported formats and external service requirements. Retain the original asset and the parameters you used so that a later failure can be traced to one step instead of rerunning the entire workflow.'),
    ],
    audience: t('适合有明确视频或媒体任务的创作者、开发者，以及愿意核对依赖并检查输出素材的人。', 'Creators and developers with a specific media task who can inspect dependencies and validate output assets.'),
    selection: t('以视频内容理解为起点时先读 claude-video；寻找中文媒体处理脚本时查看 wlzh/skills 的具体条目；已有明确缺口但前两者未覆盖时，再用 Composio 清单继续发现。', 'Start with claude-video for video-related understanding, inspect individual wlzh entries for Chinese media workflows, and use the Composio list to discover candidates for a remaining gap.'),
    comparisons: [
      row('github-com-bradautomates-claude-video', t('聚焦视频任务的开源项目。', 'An open-source project focused on video tasks.'), t('输入形式及处理依赖应以仓库说明为准。', 'Verify accepted inputs and processing dependencies in the repository.')),
      row('github-com-wlzh-skills', t('含视频下载发布的中文实用合集。', 'A Chinese practical collection including video download and publishing tasks.'), t('作者工具箱涉及多种任务，应逐项选取所需脚本。', 'The toolbox spans tasks; select and inspect only the scripts you need.')),
      row('github-com-composiohq-awesome-claude-skills', t('查找补充媒体能力的综合清单。', 'A broad list for discovering additional media capabilities.'), t('需要回到每个项目核对输出格式，不能默认互通。', 'Inspect each project’s output format rather than assuming interoperability.')),
    ],
    relatedGuides: [sourceGuide, downloadGuide],
  },
  planning: {
    overview: [
      t('长任务最容易失去的不是待办数量，而是当前决定为什么成立、哪些工作已经有证据完成、接下来该从哪里恢复。文件化规划适合把这些信息放进项目，使后来接手的人或下一次会话能够读到。开始前写清目标、范围和验收方式，再决定需要多细的任务拆分，避免计划文件逐渐变成无人维护的第二份聊天记录。', 'Long tasks need more than a list of things to do. They need a record of why decisions were made, which results have been verified and where work should resume. File-based planning can keep that information beside the project so another session or collaborator can read it. Define the goal, boundaries and acceptance checks first. Then choose a level of detail that helps the next action without turning the plan into a second, unmaintained conversation log.'),
      t('planning-with-files 把“使用文件组织规划”作为项目主题；Superpowers 展示规划如何与执行、调试和测试衔接；everything-claude-code 中文版则提供包含 agents、skills 和其他配置的中文学习入口。三者分别帮助理解持久记录、开发流程和环境组织。这里的比较关注接续任务所需的信息，而不是声称安装后就能消除上下文限制。', 'Planning-with-files directly addresses organizing agent work through files. Superpowers places planning within a wider development workflow that also includes execution, debugging and testing. The Chinese everything-claude-code project offers a broader configuration reference for Claude Code. These sources help you examine persistent records, workflow stages and environment organization respectively. None of those categories, by itself, establishes that an installed skill will remove context limits or keep a plan accurate without deliberate updates.'),
      t('一个可检验的试用方法是在完成首个小步骤后暂停任务，再仅凭计划和产物恢复工作。观察是否能找到需求、关键决定、已经验证的结果以及下一步。如果恢复时仍要猜测，先改进记录结构，而不是继续添加复杂配置。计划中的“完成”应由实际代码、文档或测试结果支撑，失败尝试与尚未确认的问题也应留在可查的位置。', 'A useful trial is to pause after one small milestone and resume using only the saved plan and actual artifacts. Check whether the requirement, key decisions, verified results and next action are clear. If resuming still requires guesswork, improve the record before adding more configuration. Mark completion from evidence in code, documents or tests. Preserve unresolved questions and failed approaches when they explain the next decision, so that future work does not repeat the same investigation.'),
    ],
    audience: t('适合跨会话开发、多步骤研究或多人接续任务，尤其是需要在项目内保留目标与决定的团队。', 'People coordinating multi-session development or other multi-step work with goals and decisions stored in the project.'),
    selection: t('主要困难是恢复上下文时，先研究 planning-with-files；需要让计划接上开发验证流程时，比较 Superpowers；想读中文环境配置示例时参考 everything-claude-code，并只采用必要部分。', 'Choose planning-with-files when resuming context is the main problem, compare Superpowers when planning needs to connect with development checks, and use everything-claude-code for Chinese configuration examples.'),
    comparisons: [
      row('github-com-othmanadi-planning-with-files', t('以文件保存规划与任务上下文。', 'Planning and task context organized in files.'), t('记录需要随实际进展维护，文件存在不代表状态准确。', 'Records must follow actual progress; their existence does not establish accuracy.')),
      row('github-com-obra-superpowers', t('把规划放进完整开发流程。', 'Planning as part of a broader development workflow.'), t('适合评估流程约定，非代码任务应先判断适用部分。', 'Evaluate the workflow conventions and which parts fit non-coding work.')),
      row('github-com-xu-xiang-everything-claude-code-zh', t('中文工作环境与配置参考。', 'Chinese references for workflow environment and configuration.'), t('涉及多个配置层，应避免一次引入与任务无关的设置。', 'Multiple configuration layers are involved; adopt only those relevant to the task.')),
    ],
    relatedGuides: [sourceGuide, downloadGuide],
  },
  security: {
    overview: [
      t('安全与审查任务需要先限定检查对象和可以执行的操作。例如，对依赖配置的阅读审查、对已有 bug 的复现、对 Skill 自带脚本的核查，是三种不同工作。清楚写下代码范围、环境和预期产物，才能判断候选工具是在帮助发现问题，还是只是输出泛泛的建议。发现清单的作用是提供线索，不能替代对具体行为的检查。', 'Security and review work begins with a defined object and scope. Reading dependency configuration, reproducing a reported bug and inspecting the scripts bundled with a skill are different activities. State which code and environment are involved and what evidence the review should produce. That makes it possible to assess whether a candidate helps find a concrete issue or merely generates general advice. A discovery list is a starting point for that assessment, not a security result.'),
      t('BehiSecc 的清单带有安全主题，可用于发现相关候选项；Cyrus 按开发和安全等类别组织市场资源；Superpowers 提供调试与测试等开发方法。保留最后一项，是因为可复现的问题和修复后的回归检查是审查工作的有用补充，并不是把它标成专门的安全扫描器。每一项的用途和边界都应从原项目重新核对。', 'The BehiSecc list is included for its security-oriented discovery focus. Cyrus provides a marketplace organized into developer categories that include security. Superpowers contributes development practices such as debugging and testing. Its role here is to support reproduction and regression checks around a finding, not to act as a dedicated security scanner. These different roles are useful only when they map to the review you are conducting and to an individual resource whose behavior you can inspect.'),
      t('筛选 Skill 时，可以阅读入口指令和脚本，确认会访问哪些文件、调用哪些服务，以及结果如何验证。试用时保留具体输入、步骤和观察到的行为，把报告中的结论作为待验证的发现。只有能解释触发条件并复现结果，才适合进入修复和回归验证。本页没有对候选资源给出安全认证、漏洞覆盖率或已经完成审计的结论。', 'When evaluating a skill, inspect its entry instructions and scripts, including file access, external calls and the way it supports verification. Preserve the inputs, steps and observed behavior from a trial. Treat reported issues as findings to investigate, then reproduce the relevant conditions before planning a fix and regression check. This page makes no claim about security certification, vulnerability coverage or completed audits of the listed resources. The comparison describes where to start and what still needs examination.'),
    ],
    audience: t('适合已明确授权范围、能够复现和审核结果的开发者与审查人员。', 'Developers and reviewers with a defined authorized scope who can reproduce and evaluate findings.'),
    selection: t('寻找安全主题候选项时用 BehiSecc；希望按市场类别比较时看 Cyrus；已经有具体问题、需要组织复现与回归测试时研究 Superpowers 的开发流程。', 'Use BehiSecc to discover security-related candidates, Cyrus to compare marketplace categories, and Superpowers to examine debugging and regression practices around an already identified issue.'),
    comparisons: [
      row('github-com-behisecc-awesome-claude-skills', t('带安全视角的发现清单。', 'A skill discovery list with a security focus.'), t('安全主题不代表每个链接项目都通过审计。', 'A security theme does not establish that every linked project has been audited.')),
      row('atcyrus-com-skills', t('含安全分类的开发市场。', 'A developer marketplace with security-related categories.'), t('需要逐项检查权限、实现与报告方式。', 'Inspect permissions, implementation and reporting for each selected item.')),
      row('github-com-obra-superpowers', t('支持问题复现和回归检查的流程参考。', 'Workflow reference for debugging and regression checks.'), t('这是开发方法，不是本页验证过的安全扫描服务。', 'Development methodology, not a security scanning service verified by this page.')),
    ],
    relatedGuides: [sourceGuide, downloadGuide],
  },
  'discover-skills': {
    overview: [
      t('发现合适的 Skill，可以从一句具体需求开始，例如“在现有项目里补充回归测试”或“润色一份中文初稿”。然后列出工作语言、宿主环境和输入格式。这样的描述能跨越不同站点的命名差异，避免只搜索一个很宽泛的类别。先找两三个与任务接近的候选项，再深入原始说明，比一次收集大量链接更容易做出选择。', 'Finding a suitable skill starts with a concrete task, such as adding a regression test to an existing project or refining a Chinese draft. Add the working language, host environment and input format. That brief travels across directories even when they use different category names. Look for a small set of plausible candidates before reading their original documentation. A shortlist you can compare is more useful than a large collection of links with no decision criteria.'),
      t('ModelScope 提供中文合集入口；skills.sh 与 SkillsMP 适合从英文目录继续发现；Qoder Community 按类别和职业角色组织多来源内容；VoltAgent 用 awesome 清单汇总项目。它们的编辑方式和浏览路径不同，同一原始资源也可能重复出现在多个入口。比较时应追溯到原作者和仓库，避免把重复收录误认为多个独立能力。', 'The sources here offer different browsing paths. ModelScope provides a Chinese collection entry point. Skills.sh and SkillsMP offer English-language discovery. Qoder Community organizes material from multiple sources by category and professional role. VoltAgent uses an awesome-list format to collect projects. The same underlying resource may appear in several places, so compare original authors and repositories rather than treating every listing as a separate capability. Discovery breadth and implementation fit answer different questions.'),
      t('建立短清单后，记录每项候选的用途、输入、依赖和安装方式，再剔除与环境不符的项目。目录里的摘要帮助确定阅读顺序，许可证和实际用法仍要看来源文档。若希望使用 SkillFlux 安装，还需要到精品 Registry 查找对应的已发布版本；导航目录的收录范围更广，不能把一个外部网站被收录当作其中所有 Skill 都可直接安装。', 'For each candidate, note the intended task, inputs, dependencies and installation route. Remove entries that do not fit the environment before comparing more subjective preferences. Directory summaries help prioritize reading, while licenses and operational instructions belong to the original source. If you want installation through SkillFlux, also check the curated Registry for a corresponding published release. The discovery catalog has a broader scope; listing an external website does not make all of its skills installable through SkillFlux.'),
    ],
    audience: t('适合刚开始寻找 Skill、已有任务但不熟悉来源分布的人，以及需要跨站比较的团队。', 'People with a concrete task who need to locate and compare skill sources across the ecosystem.'),
    selection: t('中文发现优先看 ModelScope 或 Qoder Community；英文浏览对照 skills.sh 与 SkillsMP；希望沿 GitHub 原始项目深入时使用 VoltAgent 清单。保留多个发现入口，但按原始资源去重。', 'Use ModelScope or Qoder Community for Chinese discovery, compare skills.sh and SkillsMP for English browsing, and follow VoltAgent’s list into source projects. Deduplicate candidates by their original resource.'),
    comparisons: [
      row('modelscope-cn-skills', t('中文合集起点。', 'A Chinese collection starting point.'), t('继续核对选定条目的来源与环境要求。', 'Check the selected entry’s origin and environment requirements.')),
      row('skills-sh', t('面向开发者的英文发现入口。', 'An English discovery entry point for developers.'), t('找到条目后仍需确认对应项目的使用方式。', 'Verify usage in the project behind each listing.')),
      row('skillsmp-com', t('跨来源浏览与比较。', 'Browsing and comparing resources across sources.'), t('摘要用于筛选，不替代原项目文档。', 'Summaries support discovery, not the project’s original documentation.')),
      row('qoder-community-pages-dev-zh-skills', t('按分类与职业角色查找。', 'Discovery by category and professional role.'), t('社区聚合入口与 Qoder 官方市场是不同来源。', 'This community aggregator is distinct from Qoder’s official marketplace.')),
      row('github-com-voltagent-awesome-agent-skills', t('沿 awesome 清单发现原项目。', 'Follow an awesome list into source projects.'), t('多个清单可能重复收录，应追溯仓库去重。', 'Lists can overlap; deduplicate by original repository.')),
    ],
    relatedGuides: [sourceGuide, downloadGuide],
  },
  mcp: {
    overview: [
      t('当任务需要连接外部服务或工具时，先区分需要的是操作指导，还是实际的工具连接。Skill 通常提供任务执行方式与相关材料；MCP 服务器则是了解工具接入时的一类候选来源。两者可以出现在同一工作环境中，但寻找和配置的方法不同。写出你希望 agent 读取或操作的对象，再确认当前宿主提供的接入方式。', 'When a task needs an external service or tool, separate the instructions for doing the work from the connection that exposes the tool. Skills commonly describe a workflow and its supporting material. MCP servers are a different kind of resource to investigate for tool integration. Both may appear in the same environment, but they are not interchangeable installation targets. Name the object or service the agent needs to work with before choosing a discovery source.'),
      t('MCP Servers 以服务器目录为入口，按抓取、开发和生产力等主题组织来源；MCPMarket Skills Leaderboard 是 Skill 榜单，可帮助发现邻近能力，但不是本页筛选过的一组服务器；everything-claude-code 中文版包含 MCP 等配置参考，适合学习这些配置如何与其他 agent 设置并存。保留三种入口是为了帮助辨别用途，而不是把榜单条目都称为 MCP。', 'MCP Servers is the direct server-directory entry in this shortlist, with categories including scraping, development and productivity. MCPMarket Skills Leaderboard is a skill leaderboard that can reveal adjacent capabilities; it should not be read as a set of servers selected by this page. The Chinese everything-claude-code project includes MCP configuration alongside other agent settings. These sources are grouped to explain their different roles, rather than to relabel every skill listing as an MCP integration.'),
      t('选中具体服务器后，应返回其文档确认运行方式、认证要求、数据流向和宿主支持情况。第一次连接可以选一个范围明确的读取任务，确认返回数据与预期一致，再考虑更多操作。不要仅凭目录名称或某个宿主被提及就推断所有服务器都可用。此处没有提供未经核对的连接命令，SkillFlux Registry 的 Skill 安装流程也不等于任意 MCP 服务器的配置流程。', 'After selecting a server, read its own documentation for the runtime, authentication, data flow and supported connection methods. Start with a bounded read operation and check the returned data before attempting a wider workflow. A directory mentioning a host does not establish that every listed server works with it. This page therefore does not supply an unverified connection command. SkillFlux Registry installation for skills is also distinct from configuring an arbitrary MCP server in a host application.'),
    ],
    audience: t('适合希望为 agent 接入外部工具、并需要先区分 Skill、服务器与配置示例的用户。', 'People investigating external tool connections who need to distinguish skills, servers and configuration references.'),
    selection: t('已经明确要找 MCP 服务器时，从 MCP Servers 开始；探索相关 Skill 时看 MCPMarket 榜单；需要中文配置背景时阅读 everything-claude-code。最终接入步骤以所选服务器及宿主的文档为准。', 'Start with MCP Servers for an actual server, MCPMarket for adjacent skill discovery, and everything-claude-code for Chinese configuration context. Use the selected server and host documentation for the connection itself.'),
    comparisons: [
      row('mcpservers-org', t('直接发现 MCP 服务器。', 'Direct discovery of MCP servers.'), t('目录不替每台服务器确认认证、权限或宿主支持。', 'Verify authentication, permissions and host support for each server.')),
      row('mcpmarket-com-zh-tools-skills-leaderboard', t('发现相邻 Skill 的中文榜单。', 'A Chinese leaderboard for discovering adjacent skills.'), t('这是 Skill 榜单，不能把其中所有条目视为 MCP 服务器。', 'A skill leaderboard; its entries should not all be treated as MCP servers.')),
      row('github-com-xu-xiang-everything-claude-code-zh', t('含 MCP 的中文配置参考。', 'Chinese configuration references that include MCP.'), t('示例依赖具体环境，不是本页验证过的服务器安装包。', 'Examples depend on the environment and are not verified server packages here.')),
    ],
    relatedGuides: [sourceGuide, downloadGuide],
  },
};

export const collectionDetails: Record<string, EditorialDetails> = {
  'official-start': {
    overview: [
      t('这份合集按“能够追溯到发布方”选择起点，包含中文平台、官方代码仓库和产品文档三种形式。它们回答的问题不同：平台帮助发现现有能力，仓库让你阅读具体实现，文档说明某个宿主如何组织 Skill。把这三种材料一起看，可以先建立概念，再选择与现有工作环境相关的条目。', 'This collection starts with resources that can be traced to a publisher and deliberately includes three formats: Chinese platforms, a first-party repository and product documentation. Platforms help you discover capabilities, repositories expose implementations, and documentation explains how one host organizes skills. Reading across these formats gives a more useful starting point than assuming that all official sources offer the same kind of material.'),
      t('ModelScope、阿里云 Skills 与腾讯云 SkillHub 提供不同平台的入口；Anthropic 仓库适合研究 Skill 文件；Hermes 文档适合已经使用或正在评估该 agent 的读者。选择时优先看生态和资料类型，不按厂商品牌推断兼容性、维护承诺或安全结论。合集中的“官方”描述来源身份，具体项目仍需单独检查。', 'ModelScope, Alibaba Cloud Skills and Tencent Cloud SkillHub provide platform entry points. Anthropic’s repository is useful for inspecting skill files, while Hermes documentation is relevant when evaluating or using that agent. Choose by ecosystem and material type. Official provenance identifies the source; it does not independently establish compatibility, a maintenance commitment or the safety of an individual item.'),
    ],
    audience: t('适合初次建立 Skill 概念的用户，或希望从发布方材料开始核查的开发者。', 'Newcomers building a map of skills and developers who want publisher material as their first reference.'),
    selection: t('入选依据是来源身份和资料形式的互补性。中文平台用于浏览，代码仓库用于阅读实现，产品文档用于理解宿主规则；按当前需要选一个入口即可。', 'Selection favors identifiable publishers and complementary formats: platforms for browsing, a repository for implementation, and product documentation for host conventions. Start with the format you need.'),
    comparisons: [
      row('modelscope-cn-skills', t('中文平台式发现入口。', 'Chinese platform-based discovery.'), t('找到具体 Skill 后继续核对原始说明。', 'Continue to the original instructions for a selected skill.')),
      row('github-com-anthropics-skills', t('阅读官方 Skill 实现。', 'Inspect first-party skill implementations.'), t('仓库示例与平台目录的浏览方式不同。', 'Repository examples require a different reading approach from a platform catalog.')),
      row('skills-aliyun-com-skills-orderby-install', t('阿里云生态的 Skill 入口。', 'A skill entry point in the Alibaba Cloud ecosystem.'), t('需逐项确认相关云服务与使用条件。', 'Check associated cloud services and usage terms for each item.')),
      row('skillhub-cn-dashboard', t('腾讯云 SkillHub 的中文面板入口。', 'The Chinese Tencent Cloud SkillHub dashboard.'), t('按实际覆盖的任务挑选，避免只按厂商决定。', 'Choose by task coverage rather than publisher identity alone.')),
      row('hermes-agent-nousresearch-com-docs-zh-hans-skills', t('Hermes Agent 的中文 Skill 文档。', 'Chinese skill documentation for Hermes Agent.'), t('针对 Hermes 的约定不应直接套用到其他宿主。', 'Hermes conventions should not be assumed to apply to other hosts.')),
    ],
    relatedGuides: [sourceGuide, downloadGuide],
  },
  'chinese-workflows': {
    overview: [
      t('中文工具箱围绕阅读、发现和实际写作三种成本来组织。ModelScope、Qoder Community 和 Skills.pub 提供中文浏览入口；两个 Claude Code 社区仓库提供中文说明或配置参考；Humanizer-zh 则直接针对中文表达。它们共同的入选理由是减少中文任务的理解成本，而不是因为都属于同一种工具。', 'This toolkit addresses three different needs in Chinese workflows: browsing resources, understanding instructions and editing prose. ModelScope, Qoder Community and Skills.pub provide Chinese discovery entry points. The two Claude Code community repositories provide Chinese explanations or configuration references. Humanizer-zh addresses Chinese wording itself. The selection is organized around language access, rather than treating every source as the same type of tool.'),
      t('中文界面不代表每个被链接的项目都支持中文输入，也不代表原始文档已经完整翻译。发现候选后，仍需沿链接核对原作者和实际依赖。对于已有原稿的写作任务，可以直接研究专门的润色项目；对于开发配置，先区分 agents、hooks、Skill 等部分，再采用与当前工作相关的片段。', 'A Chinese interface does not establish Chinese input support for every linked project, or a complete translation of its original documentation. Follow candidates back to their authors and dependencies. For an existing draft, the focused prose-editing project may be the shortest route. For development configuration, separate agents, hooks and skills before adopting the part relevant to your workflow.'),
    ],
    audience: t('适合偏好中文资料的 Skill 使用者、内容作者，以及需要中文配置参考的 Claude Code 用户。', 'Skill users who prefer Chinese material, Chinese-language authors and Claude Code users reading configuration references.'),
    selection: t('按“中文发现入口、中文配置材料、中文写作工具”三种用途选择，避免把所有合集都安装进同一环境。', 'Choose among Chinese discovery, configuration material and prose editing. Each serves a different purpose and does not need to be adopted as a bundle.'),
    comparisons: [
      row('modelscope-cn-skills', t('建立中文 Skill 生态概览。', 'Build a Chinese-language overview of skill sources.'), t('平台入口，具体能力需要继续选择。', 'A platform entry point, requiring a further choice of capability.')),
      row('github-com-op7418-humanizer-zh', t('直接处理中文表达的专门项目。', 'A focused project for Chinese prose editing.'), t('作者仍需复核事实和原意。', 'Authors still need to review facts and meaning.')),
      row('github-com-xu-xiang-everything-claude-code-zh', t('中文 Claude Code 配置参考。', 'Chinese Claude Code configuration references.'), t('涉及 Skill 以外的环境设置。', 'Includes environment configuration beyond skills.')),
      row('github-com-laolaoshiren-claude-code-skills-zh', t('按中文说明探索社区 Skill。', 'Explore community skills through Chinese explanations.'), t('按具体条目检查输入与安装要求。', 'Check input and installation requirements per entry.')),
      row('qoder-community-pages-dev-zh-skills', t('按角色和类别浏览聚合内容。', 'Browse aggregated sources by role and category.'), t('社区聚合与原始项目是不同维护层。', 'The aggregator and source projects have separate maintainers.')),
      row('skills-pub-zh', t('补充中文合集发现路径。', 'An additional Chinese collection discovery route.'), t('对照原始 URL，避免重复收录相同候选。', 'Compare original URLs to avoid duplicate candidates.')),
    ],
    relatedGuides: [sourceGuide, downloadGuide],
  },
  'developer-workbench': {
    overview: [
      t('开发者工作台按一个项目中可能出现的不同缺口选来源：Superpowers 对应开发流程，planning-with-files 对应长任务记录，Android 与 Expo 仓库对应移动技术栈，Cyrus 对应具体开发能力的发现。这份集合帮助你找到下一块需要阅读的材料，并不要求把五个来源一起引入项目。', 'The developer workbench is organized around gaps that can appear within a project. Superpowers addresses development workflow, planning-with-files addresses persistent task records, Android and Expo address mobile stacks, and Cyrus provides task-oriented discovery. The collection helps identify the next source to read. It is not a requirement to combine all five sources in one project.'),
      t('如果当前困难是任务无法顺利接续，先改进计划记录；如果是测试与调试缺少步骤，先看开发流程；如果问题涉及移动平台，则优先平台仓库。只有明确的缺口仍未解决时，再扩展市场搜索。选用后应以项目实际产物和现有验证方式判断效果，而不是以安装了多少条指令衡量工作台是否完整。', 'If work is difficult to resume, start with planning records. If testing or debugging lacks structure, examine a development workflow. If the issue is platform-specific, read the relevant mobile repository first. Broaden the marketplace search only for an identified gap. Evaluate the result through the project’s artifacts and existing checks, rather than by the number of instructions installed.'),
    ],
    audience: t('适合维护实际代码项目、需要逐步补充规划、测试或移动开发能力的个人与小团队。', 'Individual developers and small teams improving planning, testing or mobile development in an existing codebase.'),
    selection: t('入选资源分别覆盖流程、记录、平台与发现四层。先确定当前缺哪一层，同一层只试用一个明确候选，验证结果后再扩大。', 'The selected resources cover workflow, records, platform context and discovery. Identify the missing layer, try a bounded candidate and evaluate the result before expanding.'),
    comparisons: [
      row('github-com-obra-superpowers', t('开发方法与验证流程。', 'Development method and verification workflow.'), t('引入前理解其任务与阶段约定。', 'Understand its task and stage conventions before adoption.')),
      row('github-com-othmanadi-planning-with-files', t('长任务计划与接续记录。', 'Plans and resumption records for long tasks.'), t('实际进度变化时需要同步记录。', 'Records need updating as actual work changes.')),
      row('github-com-android-skills', t('原生 Android 场景。', 'Native Android development context.'), t('适用性受项目技术栈影响。', 'Fit depends on the project’s technology stack.')),
      row('github-com-expo-skills', t('React Native / Expo 场景。', 'React Native / Expo development context.'), t('按框架和工具版本检查原说明。', 'Check original instructions against framework and tooling versions.')),
      row('atcyrus-com-skills', t('补充开发任务的市场发现。', 'Marketplace discovery for additional developer tasks.'), t('每个条目的来源及依赖分别判断。', 'Assess each item’s origin and dependencies separately.')),
    ],
    relatedGuides: [sourceGuide, downloadGuide],
  },
  'creative-workflows': {
    overview: [
      t('从文字到视频按创作产物的变化选择来源：中文初稿可以用 Humanizer-zh 研究表达调整，视频相关任务可以阅读 claude-video，具体媒体步骤可以查看 wlzh 的工具箱，尚未确定能力时再浏览 Composio 清单。每项资源入选都有对应环节，避免用一个笼统的“创作”标签掩盖输入和输出的差别。', 'From words to video follows changes in the creative artifact. Humanizer-zh is relevant to refining a Chinese draft, claude-video to video-related tasks, and the wlzh toolbox to specific media steps. The Composio list extends discovery when the required capability is still missing. Each source has a different place in the process, with different inputs and outputs to inspect.'),
      t('这不是一条已经连接好的自动生产线。文字润色后的事实要与原稿核对，视频理解结果要与素材核对，处理后的文件要交给下一步工具试读。将作品拆成可独立检查的步骤，并保留每一步的原始素材，能让尝试某个新 Skill 的成本更可控，也能明确问题发生在哪个环节。', 'This is a reading shortlist rather than a preconnected production pipeline. Check edited claims against the draft, video interpretations against the original material, and processed files in the next tool. Divide the work into independently reviewable steps and retain their inputs. That makes a new skill easier to evaluate and makes it possible to locate which stage introduced a problem.'),
    ],
    audience: t('适合同时处理中文内容与媒体素材的创作者，以及搭建分步骤创作工作流的开发者。', 'Creators working with Chinese text and media, and developers building a sequence of reviewable creative steps.'),
    selection: t('先按当前产物选择：文字、视频内容、媒体处理或能力发现。只有上下游格式与依赖都确认后，才将两项工具组合使用。', 'Choose by the current artifact: prose, video content, media processing or capability discovery. Combine tools only after checking the handoff format and dependencies.'),
    comparisons: [
      row('github-com-op7418-humanizer-zh', t('中文初稿的表达调整。', 'Expression and wording in Chinese drafts.'), t('不承担视频处理或事实验证。', 'Does not establish video processing or factual verification.')),
      row('github-com-bradautomates-claude-video', t('围绕视频内容的专门项目。', 'A focused project around video content.'), t('按原文档确认素材输入要求。', 'Check source documentation for asset input requirements.')),
      row('github-com-wlzh-skills', t('包括下载发布的实用媒体步骤。', 'Practical media steps including downloading and publishing.'), t('个人工具箱应按单个脚本评估。', 'Evaluate the personal toolbox at the individual script level.')),
      row('github-com-composiohq-awesome-claude-skills', t('寻找其他创作环节的候选项。', 'Find candidates for another creative step.'), t('清单自身不定义一套统一输出格式。', 'The list itself does not define a shared output format.')),
    ],
    relatedGuides: [sourceGuide, downloadGuide],
  },
  'community-picks': {
    overview: [
      t('社区发现路径刻意混合目录、awesome 清单和市场。skills.sh 与 SkillsMP 提供聚合浏览；VoltAgent 与 travisvn 展示仓库清单式的编辑组织；LobeHub 与 skill0 提供各自社区或产品生态的市场入口。选择它们是为了让同一需求能从不同组织方式查找，而不是把出现次数当成质量评分。', 'Community discovery paths combine directories, awesome lists and marketplaces. Skills.sh and SkillsMP offer aggregated browsing. VoltAgent and travisvn show repository-based curation. LobeHub and skill0 provide marketplace entry points connected to their communities or ecosystems. The selection lets you approach the same requirement through different forms of organization, rather than treating repeated appearances as a quality score.'),
      t('跨站浏览时应保留原始项目 URL、作者和用途。多个列表指向同一仓库时，它仍然是同一个候选资源；来自不同平台的简介，也可能只是对同一说明的转述。确定两三个候选后回到原文档比较依赖与操作方式，再决定是否安装。社区目录适合扩展发现范围，判断实际能力仍需要查看条目本身。', 'While browsing, keep the original project URL, author and intended task. Several lists pointing to one repository still represent one candidate, and summaries on different platforms may repeat the same source description. After choosing two or three candidates, compare dependencies and usage in the original documentation. Community discovery broadens the search; evaluating the actual capability still requires examining the individual resource.'),
    ],
    audience: t('适合尚未找到合适能力、愿意跨目录比较并追溯原始项目的用户。', 'Users expanding a search across directories who are willing to trace listings back to original projects.'),
    selection: t('保留目录、GitHub 清单和市场三种发现方式，并按原始资源去重。对熟悉的生态优先看对应市场，对开放搜索优先看清单或综合目录。', 'Keep directory, repository-list and marketplace routes, deduplicating by the original resource. Prefer an ecosystem marketplace for a known environment and a broad directory or list for open-ended discovery.'),
    comparisons: [
      row('skills-sh', t('英文开发者发现入口。', 'English discovery for developers.'), t('需要继续阅读条目的源文档。', 'Continue to each entry’s source documentation.')),
      row('skillsmp-com', t('跨来源的目录式浏览。', 'Directory browsing across sources.'), t('与其他目录可能存在重复条目。', 'Entries may overlap with other directories.')),
      row('github-com-voltagent-awesome-agent-skills', t('跨 agent 主题的仓库清单。', 'A repository list spanning agent topics.'), t('逐项确认宿主要求，不继承整份清单的兼容性。', 'Verify host requirements per item rather than inheriting list-level compatibility.')),
      row('github-com-travisvn-awesome-claude-skills', t('Claude Skills 的另一份社区参考。', 'Another community reference for Claude Skills.'), t('适合对照发现，不代表独立测试结论。', 'Useful for cross-reference, not an independent testing result.')),
      row('lobehub-com-skills', t('LobeHub 生态的双语市场入口。', 'A bilingual marketplace entry in the LobeHub ecosystem.'), t('市场界面语言不等于每项 Skill 的语言能力。', 'Interface language does not establish language support for every skill.')),
      row('skill0-io', t('Claude 相关能力的社区市场。', 'A community marketplace for Claude-related capabilities.'), t('具体安装要求和行为由每项资源决定。', 'Installation requirements and behavior depend on each resource.')),
    ],
    relatedGuides: [sourceGuide, downloadGuide],
  },
  'mcp-essentials': {
    overview: [
      t('MCP 探索起点围绕“服务器、相邻 Skill、环境配置”三个概念选资料。MCP Servers 是直接查找服务器的目录；MCPMarket Skills Leaderboard 帮助发现可能与工具工作流相关的 Skill；everything-claude-code 中文版展示包含 MCP 在内的配置材料。这种组合适合先理清资源类型，再决定真正需要连接什么。', 'This MCP starting collection separates servers, adjacent skills and environment configuration. MCP Servers directly catalogs servers. MCPMarket Skills Leaderboard helps discover skills that may relate to tool workflows. The Chinese everything-claude-code project offers configuration material that includes MCP. The selection is intended to clarify resource types before you decide what actually needs to be connected.'),
      t('清单中只有第一项以服务器目录为直接定位，其他两项提供发现或学习背景。不要从名称相近推断它们使用同一安装方式。选定具体服务后，应分别查看服务器和宿主的文档，确认连接、认证与操作范围；从一个小的读取任务开始验证，再逐步加入工作流。', 'Only the first entry is directly positioned as a server directory; the other two provide discovery or learning context. Similar terminology does not imply a shared installation method. Once a service is selected, check both server and host documentation for the connection, authentication and operation scope. Verify a small read task before adding the connection to a larger workflow.'),
    ],
    audience: t('适合第一次探索 MCP、需要中文配置背景，或正在区分工具连接与 Skill 指令的用户。', 'People new to MCP, readers seeking Chinese configuration context, and users distinguishing tool connections from skill instructions.'),
    selection: t('三项入选分别提供查找、辨别和配置参考。已明确服务器需求的读者可以直接从 MCP Servers 开始，不需要先浏览整个 Skill 榜单。', 'The entries provide server discovery, adjacent skill discovery and configuration context. Readers with a defined server requirement can start directly with MCP Servers.'),
    comparisons: [
      row('mcpservers-org', t('直接查找官方与社区服务器。', 'Find official and community servers directly.'), t('单个服务器的支持情况需要单独核对。', 'Check support and requirements for each individual server.')),
      row('mcpmarket-com-zh-tools-skills-leaderboard', t('理解与发现相邻 Skill。', 'Understand and discover adjacent skills.'), t('榜单是发现参考，不是本合集的服务器测试结果。', 'A discovery reference, not a set of server test results.')),
      row('github-com-xu-xiang-everything-claude-code-zh', t('理解 MCP 与其他配置如何并存。', 'Understand MCP alongside other configuration elements.'), t('从示例到自己的宿主仍需核对环境差异。', 'Check environment differences before adapting an example to your host.')),
    ],
    relatedGuides: [sourceGuide, downloadGuide],
  },
};
