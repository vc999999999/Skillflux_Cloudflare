# SkillFlux VPS 部署清单（网站在 Cloudflare，Registry 在 VPS）

目标架构：

```
访客浏览器 ──▶ Cloudflare Workers（静态站点 + 边缘重定向/noindex）
   表单/广告预览 ──浏览器直连──▶ https://registry.skillflux.cn ──▶ VPS 上的 Registry 容器
skillflux CLI / MCP ────────────────────────────────────────────────▶ 同上
发布流程：本机 publication:sync 拉签名快照 → 重建 → wrangler deploy
```

## 当前生产环境

网站为 `https://skillflux.cn`，Registry 为 `https://8.210.176.19`。公网 IP 已配置受信任 HTTPS，Caddy 自动续期；不需要为后端另配域名。下文的 `registry.skillflux.cn` 是采用域名时的示例。

在仓库根目录执行：

```bash
# 同步真实生产快照、构建，再发布现有 skillflux Worker
npm run deploy:production --workspace @skillflux/web
```

该命令使用 `web/data/registry-production-key.json` 钉住生产公钥，并将独立产物放入 `web/.publication/production/dist`。表单和接入指南使用同一生产 Registry；原有 `web/data/registry-publication.json` 保留，不会被同步覆盖。每次强制重建，确保仅修改前端源码时也能发布。Registry 为空时，精品库如实显示当前状态。

只构建并检查部署配置：

```bash
npm run build:production --workspace @skillflux/web
cd web
npx wrangler deploy .publication/production/dist/_worker.js \
  --assets .publication/production/dist --config wrangler.workers.jsonc --dry-run
```

Wrangler 需要已登录的 Cloudflare 账号。生产公钥可以公开，管理员 Token 和服务器私钥不能放入前端环境变量或静态产物。更换 Registry 身份时，应先通过服务器核实新公钥，再显式更新钉住的公钥。

## 一、VPS 准备

- 最低 1 vCPU / 1 GB / 20 GB 磁盘（Node 24 + SQLite，技能包都是 KB 级文本）
- 装 Docker 与 compose 插件
- 使用域名时，DNS 的 `registry.skillflux.cn` A 记录指向 VPS IP；使用公网 IP HTTPS 时无需此记录
- 防火墙只放 22/80/443；Registry 容器只绑 `127.0.0.1`，TLS 由反代终结

## 二、Registry 容器

仓库自带 `mcp/Dockerfile`（多阶段、非 root、healthcheck）。`compose.yaml` 里的 `web` 服务是给"全在 VPS"方案的；只跑 Registry 时单独起它：

```bash
git clone <repo> && cd Skillflux_Cloudflare
cp .env.example .env
```

`.env` 里需要（生成 token：`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`）：

```
SKILLFLUX_ADMIN_TOKEN=<强随机值，只放 .env，绝不进仓库>
SKILLFLUX_PUBLIC_URL=https://registry.skillflux.cn     # 必须是纯 origin，无路径
SKILLFLUX_ALLOWED_ORIGINS=https://skillflux.cn         # 逗号可加 http://localhost:4321
SKILLFLUX_TRUSTED_PROXIES=<Caddy/Nginx 所在网卡 IP；不要信任意 X-Forwarded-*>
```

`compose.yaml` 的 registry 服务只 `expose` 不发布端口，加 override 把端口绑到回环：

```yaml
# compose.vps.yaml
services:
  registry:
    ports: ["127.0.0.1:8787:8787"]
  web:
    profiles: ["disabled"]
```

```bash
docker compose -f compose.yaml -f compose.vps.yaml up -d --build registry
curl http://127.0.0.1:8787/health   # {"status":"ok"}
```

持久化在 `registry-data` 卷（SQLite + Ed25519 签名密钥都在 `/data`）；备份就备份这个卷。**数据目录丢失 = 密钥轮换 + 全部技能要重新审核**，把这个卷纳入备份。

## 三、HTTPS 反代（Caddy，最省事）

```
# /etc/caddy/Caddyfile
registry.skillflux.cn {
    reverse_proxy 127.0.0.1:8787
}
```

`systemctl reload caddy`，Caddy 自动签证书。Nginx 则按常规 `proxy_pass http://127.0.0.1:8787;` + certbot。

验证：

```bash
curl https://registry.skillflux.cn/health
curl https://registry.skillflux.cn/v1/keys     # 保存返回 JSON，下一步要用
```

## 四、网站侧（本机或 CI）

仓库里的快照钉住的是旧签名密钥，第一次连新 Registry 必须显式迁移：

```bash
cd web
curl -s https://registry.skillflux.cn/v1/keys > /tmp/registry-key.json
SITE_URL=https://skillflux.cn npx tsx scripts/publication-build.ts \
  --registry https://registry.skillflux.cn \
  --trust-key /tmp/registry-key.json \
  --output .publication/production --force
# 既有 production 快照会钉住签名身份；切换服务时始终明确核对公钥。
```

上述命令已完成构建，再从 `web` 目录部署到 Cloudflare：

```bash
npx wrangler deploy --config wrangler.workers.jsonc --keep-vars
```

`publication:build` 自动设置 `PUBLIC_REGISTRY_URL`，构建时写入 `/advertise/`、`/report/` 页面供浏览器直连。公开 `/console/` 页面已下线，旧地址重定向到 `/registry/`；运营需通过受保护的 admin API 操作。Wrangler 的默认入口和资源目录也指向该生产产物；普通 `npm run build` 的 `web/dist` 不用于生产发布。

## 五、日常发布流

```
新技能/改广告/撤销 ──(受保护的 admin API)──▶ Registry 库更新
        │
        ▼
npm run deploy:production --workspace @skillflux/web
```

Registry 重启**不需要**重新部署网站；但每次审核/撤销后必须重跑 sync + build + deploy，静态页才反映最新快照。

## 六、上线前 checklist

- [ ] `curl https://registry.skillflux.cn/v1/admin/skills` 无 token 返回 401
- [ ] `curl https://registry.skillflux.cn/v1/catalog` 返回签名 JSON
- [ ] `/health` 通；`/v1/keys` 公钥与 trust-key 文件一致
- [ ] CLI 端到端：`skillflux init --registry https://registry.skillflux.cn` → `search` → `plan` → `install` 全通
- [ ] 网站上 `skillflux install` 命令指向生产 registry（mcp CLI 的 `DEFAULT_REGISTRY` 发布 npm 前改为生产地址）
- [ ] 表单页 `/advertise/` 提交后返回记录编号（说明 CORS + URL 都对了）
- [ ] `docker compose logs registry` 无报错；`registry-data` 卷已纳入备份
