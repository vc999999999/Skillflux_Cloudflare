import type { Language } from './i18n';

type Translation = Record<Language, string>;
export interface Scenario {
  slug: string; title: Translation; summary: Translation; updatedAt: string;
  sections: { title: Translation; body: Translation; command?: string }[];
  sourceCategories: string[];
}

export const scenarios: Scenario[] = [
  {
    slug: 'choose-a-source', updatedAt: '2026-10-29',
    title: { zh: '官方合集、市场和社区仓库，应该怎么选？', en: 'Vendor collections, marketplaces or community repositories?' },
    summary: { zh: '先看任务、来源和维护证据，再决定是否安装。黄页收录只说明来源存在，不等于其中每个 Skill 都经过测试。', en: 'Start with your task, provenance and maintenance evidence. Directory inclusion shows that a source exists; it does not mean every skill in it was tested.' },
    sourceCategories: ['official', 'marketplace', 'repo'],
    sections: [
      { title: { zh: '先写下你需要的结果', en: 'Describe the result you need' }, body: { zh: '用一句话描述任务的输入和期望输出，例如“把访谈记录整理成带证据索引的结论”。再确认你使用的宿主，以及是否允许联网或执行代码。来源的名气不能代替任务匹配。', en: 'Describe the input and expected output in one sentence, such as turning interview notes into findings with evidence references. Check the host and whether network or code execution is permitted. A familiar source does not guarantee a task fit.' } },
      { title: { zh: '从原始说明核对能力', en: 'Read the original description' }, body: { zh: '打开来源详情，阅读用途、原始链接、许可证和维护日期。黄页中的来源标签是编辑整理信息，不是对其中每个包的测试证明。外部仓库的实时状态和许可条款仍以原站为准。', en: 'Open a source detail page and inspect its purpose, original links, license and maintenance date. Directory labels are editorial metadata, not proof that every package was tested. Confirm current terms and repository status at the original source.' } },
      { title: { zh: '找独立测试数据，而不是只看星标', en: 'Look for independent measurements, not just stars' }, body: { zh: '星标和下载量反映关注度，不反映在你的任务上是否有效。优先参考公开了方法、样本量、模型版本和日期的测试结果；没有这类数据时，把来源说明当作作者自述来读。', en: 'Stars and download counts measure attention, not whether a skill helps on your task. Prefer results that publish their method, sample size, model version and date. Without such data, read a source description as the author’s own claim.' } },
      { title: { zh: '在隔离项目里确认效果', en: 'Verify suitability in a separate project' }, body: { zh: '阅读边界和输入输出示例后，在不含生产密钥的测试项目尝试。记录适用和不适用的情况。人工测试说明能帮助选型，但不能保证在不同模型和任务中获得完全相同的结果。', en: 'After reviewing limitations and examples, try the release in a test project without production secrets. Record where it works and where it does not. A usage-test summary helps selection but cannot guarantee identical results across models and tasks.' } },
    ],
  },
];

export function getScenario(slug: string): Scenario | undefined { return scenarios.find(item => item.slug === slug); }
