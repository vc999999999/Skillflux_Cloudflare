# SkillFlux Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete SkillFlux Astro static frontend from the PRD and visual HTML.

**Architecture:** JSON catalog files feed TypeScript content helpers. Astro pages consume those helpers to generate static human pages and machine-readable endpoints.

**Tech Stack:** Astro, TypeScript, Vitest, native CSS, Cloudflare Pages-compatible static output.

---

### Task 1: Catalog Contract

**Files:**
- Create: `tests/content.test.ts`
- Create: `src/lib/content.ts`
- Create: `src/config.ts`
- Create: `data/sites.json`
- Create: `data/categories.json`
- Create: `scripts/validate-data.ts`

- [x] **Step 1: Write failing tests** for catalog size, unique IDs/slugs, category references, index payload, and LLM full text.
- [ ] **Step 2: Run `npm test` and confirm the tests fail because implementation modules do not exist.**
- [ ] **Step 3: Implement content helpers, configuration, data files, and validation script.**
- [ ] **Step 4: Run `npm test` and `npm run validate`.**

### Task 2: Astro Pages

**Files:**
- Create: `src/layouts/BaseLayout.astro`
- Create: `src/components/Header.astro`
- Create: `src/components/Footer.astro`
- Create: `src/components/ResourceTable.astro`
- Create: `src/components/ResourceCard.astro`
- Create: `src/pages/index.astro`
- Create: `src/pages/directory.astro`
- Create: `src/pages/category/[slug].astro`
- Create: `src/pages/site/[slug].astro`

- [ ] **Step 1: Implement the shared layout and navigation.**
- [ ] **Step 2: Build the home page using featured resources, stats, categories, AI endpoints, and packaged-bundle CTA.**
- [ ] **Step 3: Build directory, category, and detail pages with static data.**
- [ ] **Step 4: Add JSON-LD per page family.**

### Task 3: Machine-Readable Endpoints

**Files:**
- Create: `src/pages/llms.txt.ts`
- Create: `src/pages/llms-full.txt.ts`
- Create: `src/pages/index.json.ts`
- Create: `src/pages/feed.xml.ts`
- Create: `src/pages/robots.txt.ts`

- [ ] **Step 1: Generate plain text LLM files from catalog helpers.**
- [ ] **Step 2: Generate JSON index with schema version, build time, categories, sites, and counts.**
- [ ] **Step 3: Generate RSS and robots output.**

### Task 4: Styling And Verification

**Files:**
- Create: `src/styles/global.css`
- Modify: all Astro page/component files as needed.

- [ ] **Step 1: Implement the responsive visual system based on the supplied design.**
- [ ] **Step 2: Run `npm run build`.**
- [ ] **Step 3: Launch local preview and inspect with Playwright across desktop and mobile.**
