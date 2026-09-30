# SkillFlux VPS 部署清单（网站在 Cloudflare，Registry 在 VPS）

目标架构：

```
访客浏览器 ──▶ Cloudflare Workers（静态站点 + 边缘重定向/noindex）
   表单/console/广告预览 ──浏览器直连──▶ https://registry.skillflux.cn ──▶ VPS 上的 Registry 容器
skillflux CLI / MCP ────────────────────────────────────────────────▶ 同上
发布流程：本机 publication:sync 拉签名快照 → 重建 → wrangler deploy
```

## 一、VPS 准备

- 最低 1 vCPU / 1 GB / 20 GB 磁盘（Node 24 + SQLite，技能包都是 KB 级文本）
- 装 Docker 与 compose 插件
- DNS：`registry.skillflux.cn` A 记录指向 VPS IP
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
npx tsx scripts/sync-publication.ts \
  --registry https://registry.skillflux.cn \
  --trust-key /tmp/registry-key.json
# 之后例行同步只需：--registry https://registry.skillflux.cn
```

构建 + 部署到 Cloudflare：

```bash
PUBLIC_REGISTRY_URL=https://registry.skillflux.cn npm run build --workspace @skillflux/web
cd web && npx wrangler deploy --config wrangler.workers.jsonc
```

`PUBLIC_REGISTRY_URL` 会在构建时烘进 `/console/`、`/advertise/`、`/report/` 页面供浏览器直连；不配则表单自动显示"未配置"并禁用（安全降级）。

## 五、日常发布流

```
新技能/改广告/撤销 ──(admin API 或 /console/)──▶ Registry 库更新
        │
        ▼
npx tsx scripts/sync-publication.ts --registry https://registry.skillflux.cn
npm run build --workspace @skillflux/web && (cd web && npx wrangler deploy)
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
