# SkillFlux Frontend Design

## Goal

Build the SkillFlux MVP as a static, SEO-friendly Astro site that turns one JSON resource catalog into human-readable pages and AI-readable files.

## Product Shape

The site uses the supplied PRD and visual HTML as the approved direction. The first screen must make "技流 SkillFlux" and "skill/MCP 生态入口" unmistakable, then move directly into featured resources, directory browsing, machine-readable endpoints, and a restrained packaged-bundle CTA.

## Architecture

Astro statically generates `/`, `/directory`, `/category/[slug]`, `/site/[slug]`, `/llms.txt`, `/llms-full.txt`, `/index.json`, `/feed.xml`, `/robots.txt`, and sitemap output. `data/sites.json` and `data/categories.json` are the source of truth. Shared TypeScript helpers validate data, compute stats, render machine-readable text, and keep pages consistent.

## Visual System

The implementation adapts the design file into a responsive editorial directory interface: warm paper background, hard black rules, red accent blocks, compact metadata, dense tables on desktop, stacked resource cards on mobile, and a dark machine-readable section. No external fonts or large images are required for the MVP.

## Testing

Automated tests cover catalog validation, minimum seed content, category consistency, generated JSON payload shape, and full-text LLM output. The build runs validation before Astro generation.
