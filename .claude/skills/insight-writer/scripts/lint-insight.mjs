#!/usr/bin/env node
// 快速自检拆解文章：禁用句式、槽位数量、署名、正文体量。
// 用法（在仓库根目录）: node .claude/skills/insight-writer/scripts/lint-insight.mjs web/src/content/insights/<slug>.md
// schema 的最终裁决在 `npm run build`；本脚本只做写作层的提前拦截。
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(resolve(process.cwd(), "package.json"));
const { parse } = require("yaml");

const file = process.argv[2];
if (!file) {
  console.error("usage: lint-insight.mjs <path-to-article.md>");
  process.exit(2);
}

const raw = readFileSync(file, "utf8");
const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
if (!match) {
  console.error("FAIL: 找不到 frontmatter（--- 包裹的 YAML 块）");
  process.exit(1);
}

const [, fmRaw, body] = match;
let fm;
try {
  fm = parse(fmRaw);
} catch (error) {
  console.error(`FAIL: frontmatter YAML 解析失败: ${error.message}`);
  process.exit(1);
}

const problems = [];
const warn = [];

// --- 槽位数量（与 web/src/content.config.ts 对齐）---
const minCounts = [
  ["scenarios", 2],
  ["workflow", 3],
  ["judgments", 3],
  ["painPoints", 2],
  ["limitations", 2],
  ["tags", 1]
];
for (const [key, min] of minCounts) {
  const value = fm[key];
  if (!Array.isArray(value) || value.length < min) {
    problems.push(`${key} 需要 ≥${min} 条，当前 ${Array.isArray(value) ? value.length : 0}`);
  }
}

// --- 署名三件套 ---
for (const key of ["repo", "author", "license"]) {
  if (!fm.source?.[key] || String(fm.source[key]).trim().length === 0) {
    problems.push(`source.${key} 缺失——拆解别人的作品必须署名`);
  }
}
if (fm.source?.repo && !/^https:\/\//.test(fm.source.repo)) {
  problems.push("source.repo 必须是 https 地址");
}

// --- painPoints / workflow 结构 ---
for (const [i, item] of (fm.painPoints ?? []).entries()) {
  if (!item?.pain || !item?.solution) problems.push(`painPoints[${i}] 缺 pain 或 solution——这是映射不是罗列`);
}
for (const [i, item] of (fm.workflow ?? []).entries()) {
  if (!item?.step || !item?.detail) problems.push(`workflow[${i}] 缺 step 或 detail`);
}

// --- 禁用句式（批量低质内容指纹）---
const banned = [/随着/, /在.{1,12}的(今天|时代|当下)/, /近年来/, /众所周知/, /未来可期/, /拭目以待/];
const checkText = [fm.title, fm.description, fm.tldr, body].join("\n");
for (const pattern of banned) {
  const hit = checkText.match(pattern);
  if (hit) problems.push(`禁用句式命中: 「${hit[0]}」——换成直接给事实的写法`);
}

// --- 正文体量与结构 ---
const bodyText = body.trim();
const sections = (bodyText.match(/^## /gm) ?? []).length;
if (bodyText.length < 800) problems.push(`正文 ${bodyText.length} 字符，<800——增量不够，回到 style-guide 的三问`);
if (sections < 3) problems.push(`正文只有 ${sections} 个 ## 小节，需要 3–5 个`);
if (sections > 6) warn.push(`正文有 ${sections} 个小节，偏多——考虑合并`);

// --- 日期格式 ---
for (const key of ["datePublished", "dateModified"]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fm[key] ?? ""))) problems.push(`${key} 必须是 YYYY-MM-DD`);
}

if (warn.length) console.log(warn.map((w) => `WARN: ${w}`).join("\n"));
if (problems.length) {
  console.error(problems.map((p) => `FAIL: ${p}`).join("\n"));
  console.error(`\n${problems.length} 个问题。修完后再跑 npm run build 做 schema 终审。`);
  process.exit(1);
}
console.log(`OK: ${file} 通过写作层检查（正文 ${bodyText.length} 字符，${sections} 小节）。下一步: npm run build`);
