# SkillFlux 运行说明

更新日期：2026-10-01（GitHub 目录仓库架构）

## 架构

- **技能内容**：GitHub 目录仓库 [vc999999999/skillflux-catalog](https://github.com/vc999999999/skillflux-catalog)，`skills/<id>/<version>/` + 生成式 `index.json`。无自托管服务器。
- **客户端**：npm CLI + 本地 stdio MCP。搜索在本机缓存的索引上进行；下载钉 commit SHA、逐文件验 sha256。
- **网站**：Astro 静态构建，部署至 Cloudflare Workers；公开技能内容来自目录仓库快照。

免签名信任模型：GitHub 账号 2FA + 分支保护 + commit SHA 钉扎 + 逐文件 sha256 + 目录仓库 CI 一致性检查。

## 目录仓库维护

```bash
# 修改技能内容后（同一 <id>/<version>/ 目录内容不可变）：
skillflux catalog /path/to/skillflux-catalog           # 重新生成 index.json
git diff && git add -A && git commit && git push       # 审查后提交
```

CI（目录仓库 `.github/workflows/verify.yml`）运行 `skillflux catalog --check .`：`index.json` 与目录内容不一致即失败。

审核流程：`skillflux.review.json` 的 `status` 字段决定发布状态；人工评测（`kind: "human"`）的 `contentHash` 必须绑定当前目录内容——`skillflux catalog build` 会校验该绑定。`simulation` 证据不能使版本 qualified。撤销 = 将 review status 改为 `revoked` + 重建 index，依赖者派生状态随之失效。

## 网站发布

```bash
npm run build:production --workspace @skillflux/web    # 同步真实目录仓库快照 + 构建
npm run deploy:production --workspace @skillflux/web    # wrangler 部署到 Cloudflare
```

`publication:build --watch --repo ... --interval 60` 持续同步；相同 commit SHA 跳过重建。失败保留上一份有效站点与快照。

发布构建只接受 GitHub Catalog v2 快照；构建完成后才切换生产产物指针。目录仓库身份固定，不能在同一产物路径下悄悄更换仓库。

Wrangler 需要已登录的 Cloudflare 账号；`wrangler.workers.jsonc` 的路由与产物路径已指向生产配置。紧急撤销还需处理部署端/CDN 缓存；不能声称已追回用户下载或模型已经读入的旧文字。

## 备份与恢复

- 目录仓库备份 = `git clone` / fork；历史回溯依赖 git 历史。
- 网站重建随时可从目录仓库完整重放。
- 无服务器数据库需要备份；旧 VPS Registry（SQLite + 签名密钥）已废弃，确认无引用后即可下线。

## 客户端离线与缓存行为

- 目录索引缓存最长 24 小时；主动检查刷新。
- 离线加载：可加载此前已验证的已安装内容，但明确披露「当前目录仓库状态未知」；离线安装、升级、回滚不允许。
- 已知撤销不会因离线而被绕过：本地锁与安装记录保留最近一次已知状态。

## 国内可达性预留

`raw.githubusercontent.com` 在部分网络环境下不可达。客户端 `init --source URL` 可指定镜像源。如需为 skillflux.app 增加透传缓存路由（Worker `/gh/` 路由回源 raw 并按 SHA 缓存），在 `web/edge/worker.ts` 的 `/console` 重定向之后插入；当前未实现。
