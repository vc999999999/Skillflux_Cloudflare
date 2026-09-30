type TagEditorial = { searchValue: boolean; intro: { zh: string; en: string } };

// A tag is an editorial landing page only when its purpose and introduction are
// maintained here. Counts alone do not confer indexing eligibility.
const tagEditorial: Record<string, TagEditorial> = {
  'agent-skills': {
    searchValue: true,
    intro: {
      zh: 'Agent Skills 把任务说明、参考资料和可选脚本组织成可供 Agent 读取的能力包。本页汇集介绍、分发或维护这类资源的来源，便于从原始文档理解组织方式。先按具体任务缩小范围，再检查宿主、依赖、许可证及工具权限；目录收录不代表每项 Skill 都经过安装与效果验证。',
      en: 'Agent skills package task instructions, reference material and optional scripts for an agent to read. These sources help you discover how skills are organized and distributed. Start with a concrete task, inspect the original instructions, and check the host, dependencies and license. A source listing describes where to investigate; it does not certify every skill in a repository or marketplace.'
    }
  },
  collection: {
    searchValue: true,
    intro: {
      zh: '资源合集适合建立候选清单，但合集里的条目可能来自不同维护者，拥有不同许可与安装要求。本页聚合提供多项资源的仓库、平台和清单。阅读时优先追溯原始项目，而不是一次导入整套内容。需要围绕具体任务比较来源，可以继续查看 SkillFlux 的指南与资源详情页。',
      en: 'Skill collections are useful for building a shortlist, but entries may have different maintainers, licenses and setup requirements. This page groups repositories, platforms and lists that gather multiple resources. Follow individual entries to their original projects before choosing one. For a task-specific comparison, use the SkillFlux guides and resource detail pages rather than importing an entire list into a project.'
    }
  },
  'open-source': {
    searchValue: true,
    intro: {
      zh: '公开源码便于检查 Skill 的说明、脚本和变更记录。本页按现有目录资料归集提供公开仓库的来源；能看到代码不等于所有内容采用相同许可证。比较项目时，分别核对 LICENSE、依赖与实际执行的命令，再决定复制说明文件、运行脚本或采用其中某一项能力。',
      en: 'Public repositories let you inspect skill instructions, scripts and change history. These entries point to sources recorded in the catalog as open-source resources. Visible code does not establish a uniform license across a collection. Review the repository license, dependencies and commands separately before copying instructions or executing scripts, and compare focused projects with broader collections.'
    }
  },
  github: {
    searchValue: true,
    intro: {
      zh: 'GitHub 来源允许直接阅读仓库中的实现与文档。本页同时包含具体项目和 awesome 清单，两者承担不同角色：项目提供实际文件，清单主要提供发现入口。先找到目标 Skill 的原始目录和说明，再检查许可证、版本与依赖。仓库托管在 GitHub 本身不构成质量或安全保证。',
      en: 'GitHub sources expose repository files and documentation directly. This group includes both implementation repositories and awesome lists: implementations contain usable files, while lists mainly lead you to other projects. Locate the original skill directory, review its instructions and license, and check version and dependency requirements. GitHub hosting alone is not a quality assessment or a security review.'
    }
  },
  chinese: {
    searchValue: true,
    intro: {
      zh: '中文资料有助于理解用法和编辑习惯，但文档语言、模型输出语言与实际运行环境是三回事。本页收录包含中文说明、中文入口或中文写作能力的来源。选择时核对是否为翻译、是否能回到上游原文，以及目标任务是否涉及中文表达；不要仅凭界面语言判断兼容性。',
      en: 'Chinese-language sources can make instructions and editorial conventions easier to evaluate. This group includes Chinese documentation, localized discovery platforms and resources focused on Chinese writing. Documentation language, generated output and runtime support are separate questions. Check whether a source is a translation, trace it to the upstream project where possible, and select it for the task rather than assuming compatibility from its interface language.'
    }
  }
};

export function getTagEditorial(slug: string): TagEditorial | undefined {
  return tagEditorial[slug];
}
