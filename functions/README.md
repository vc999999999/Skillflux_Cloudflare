# SkillFlux Registry API

Cloudflare Pages Functions + D1，为 `skillflux-mcp` 提供 catalog、设备授权与支付。

## 端点

| 路径 | 方法 | 说明 |
|---|---|---|
| `/api/pack` | GET | catalog metadata（无 token 仅 free tier） |
| `/api/skill/:id` | GET | 授权 skill 文件 payload |
| `/api/device/start` | POST | 创建设备登录 session |
| `/api/device/status` | POST/GET | 轮询授权 / 校验 token |
| `/api/auth/github/start` | GET | 跳转 GitHub OAuth |
| `/api/auth/callback/github` | GET | GitHub OAuth 回调 |
| `/api/auth/callback/fixture` | GET | Fixture 登录（开发） |
| `/api/checkout` | POST | Stripe 或 fixture checkout |
| `/api/checkout/fixture-complete` | GET | Fixture 支付完成 |
| `/api/webhooks/payment/stripe` | POST | Stripe webhook 写 entitlement |

页面：`/device?session=...&code=...` — 浏览器设备授权。

## 构建 catalog

```bash
cd skillflux-pack && npm run sync:hash && npm run validate:pack
cd .. && npm run sync:pack
npm run build
```

## 本地调试

```bash
npm run pages:dev
# API: http://localhost:8788/api/pack
# Device page: http://localhost:8788/device
```

### Fixture 全流程（默认 `SKILLFLUX_FIXTURE_MODE=1`）

```bash
# 1. 创建设备 session
curl -s -X POST http://localhost:8788/api/device/start \
  -H 'content-type: application/json' \
  -d '{"deviceId":"dev","agent":"cursor"}' | jq .

# 2. 浏览器打开 loginUrl，或 fixture 登录：
#    /api/auth/callback/fixture?session=<deviceSessionId>
#    加 &purchase=1 可授予 deluxe entitlement

# 3. 轮询状态（或 Bearer 校验）
curl -s -X POST http://localhost:8788/api/device/status \
  -H 'content-type: application/json' \
  -d '{"deviceSessionId":"<id>"}' | jq .

# 4. 拉 catalog / skill
curl -s http://localhost:8788/api/pack \
  -H 'authorization: Bearer <deviceToken>' | jq .

curl -s http://localhost:8788/api/skill/demo-skill \
  -H 'authorization: Bearer <deviceToken>' | jq .
```

## 环境变量

| 变量 | 说明 |
|---|---|
| `SKILLFLUX_FIXTURE_MODE` | `1` 启用 fixture auth/checkout |
| `SITE_URL` | 站点根 URL（OAuth redirect） |
| `SKILLFLUX_PRODUCT` | 产品 id，默认 `deluxe-pack` |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth |
| `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID` / `STRIPE_WEBHOOK_SECRET` | Stripe |
| `SKILLFLUX_API_DEV_TOKEN` | 开发用 Bearer bypass |

D1 binding：`DB`（见 `wrangler.toml`）。首次请求会自动建表；也可手动：

```bash
npm run db:migrate:local
```

## MCP 对接

```bash
export SKILLFLUX_API_URL=http://localhost:8788/api
export SKILLFLUX_FIXTURE=0
skillflux mcp start
```

MCP 工具流：`auth.start` → 浏览器登录 → `auth.status` → `skill.install` / `skill.restore`。

`needs_payment` 状态下可安装 free tier skills；deluxe 需 `billing.checkout` 后重新 `auth.status`。
