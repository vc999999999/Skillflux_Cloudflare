#!/usr/bin/env node
// 对一篇拆解文章输出目录跑客观断言，输出 grading.json 的 expectations 数组。
// 用法: node grade-article.mjs <outputs-dir> <expected-repo-url> [required-related-site]
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire("/Users/vcbb/Documents/opc项目/skillflux/package.json");
const { parse } = require("yaml");

const [dir, expectedRepo, requiredRelatedSite] = process.argv.slice(2);
const expectations = [];
const push = (text, passed, evidence) => expectations.push({ text, passed, evidence });

const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
const articleFiles = files.filter((f) => !/^(RUN_NOTES|REJECTION|README)/i.test(f));
const articleName = articleFiles[0];

push(
  "产出了拆解文章 .md 文件（而不是拒写或只有说明文档）",
  articleFiles.length === 1,
  `outputs 目录 md 文件: [${files.join(", ")}], 判定文章文件: ${articleName ?? "无"}`
);

if (!articleName) {
  console.log(JSON.stringify(expectations, null, 2));
  process.exit(0);
}

const raw = readFileSync(join(dir, articleName), "utf8");
const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
let fm = {};
let body = "";
if (match) {
  try {
    fm = parse(match[1]) ?? {};
  } catch {
    fm = {};
  }
  body = match[2].trim();
}

const counts = {
  scenarios: [2, fm.scenarios?.length ?? 0],
  workflow: [3, fm.workflow?.length ?? 0],
  judgments: [3, fm.judgments?.length ?? 0],
  painPoints: [2, fm.painPoints?.length ?? 0],
  limitations: [2, fm.limitations?.length ?? 0]
};
const countFails = Object.entries(counts).filter(([, [min, got]]) => got < min);
push(
  "结构化槽位达到 schema 最小数量：scenarios≥2、workflow≥3、judgments≥3、painPoints≥2、limitations≥2",
  countFails.length === 0,
  Object.entries(counts).map(([k, [min, got]]) => `${k}=${got}/${min}`).join(", ")
);

const repoOk = (fm.source?.repo ?? "").replace(/\/$/, "") === expectedRepo.replace(/\/$/, "");
const authorOk = Boolean(fm.source?.author?.trim());
const licenseOk = Boolean(fm.source?.license?.trim());
push(
  `署名完整且正确：source.repo 为 ${expectedRepo}，author 与 license 非空`,
  repoOk && authorOk && licenseOk,
  `repo=${fm.source?.repo ?? "缺"}, author=${fm.source?.author ?? "缺"}, license=${licenseOk ? "有" : "缺"}`
);

const banned = [/随着/, /在.{1,12}的(今天|时代|当下)/, /近年来/, /众所周知/, /未来可期/, /拭目以待/];
const checkText = [fm.title, fm.description, fm.tldr, body].join("\n");
const hits = banned.map((p) => checkText.match(p)?.[0]).filter(Boolean);
push(
  "全篇无禁用套话（随着/近年来/众所周知/在…的今天/未来可期/拭目以待）",
  hits.length === 0,
  hits.length ? `命中: ${hits.join("、")}` : "无命中"
);

const sections = (body.match(/^## /gm) ?? []).length;
push(
  "正文有实质增量：≥800 字符且含 3–6 个 ## 小节",
  body.length >= 800 && sections >= 3 && sections <= 6,
  `正文 ${body.length} 字符，${sections} 个小节`
);

if (requiredRelatedSite) {
  const has = Array.isArray(fm.relatedSites) && fm.relatedSites.includes(requiredRelatedSite);
  push(
    `relatedSites 包含站内收录条目 ${requiredRelatedSite}（内链闭环）`,
    has,
    `relatedSites=${JSON.stringify(fm.relatedSites ?? [])}`
  );
}

console.log(JSON.stringify(expectations, null, 2));
