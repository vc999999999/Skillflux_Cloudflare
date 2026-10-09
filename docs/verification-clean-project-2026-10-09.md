# 空项目接入与真实 MCP 流程验证

验证时间：2026-10-09T14:39:13.895Z。客户端：公开 npm 包 `@skillflux/mcp@1.1.0`。结果：通过。

本记录验证分发与加载流程，不属于新增技能的人工质量评测，也不授予候选包安装资格。

## 环境与来源

- 在主项目之外建立空用户项目和独立客户端目录，npm 缓存初始为空。
- 独立空 npm 用户配置、全局配置及最小子进程环境；未传递 npm/GitHub 登录凭据。
- 使用本机 Node v25.2.1 和网络代理，属于独立项目测试，不是全新操作系统或安全隔离容器。
- 客户端从 [公开 npm tarball](https://registry.npmjs.org/@skillflux/mcp/-/mcp-1.1.0.tgz) 安装，关闭依赖生命周期脚本；安装锁文件的 integrity 与 registry 元数据一致。
- 技能来自 [vc999999999/skillflux-catalog 固定提交 `e2951f227f`](https://github.com/vc999999999/skillflux-catalog/tree/e2951f227fa2de4f269f244179a5d04068713464)，未使用本地源码包或模拟目录服务。

## 实际执行流程

1. 获取公开 npm 元数据，安装 `@skillflux/mcp@1.1.0`，确认安装后的 CLI 可运行。
2. 在空项目中运行 `init --host codex --preauthorize-reviewed-text --update-policy follow-compatible`，固定目录仓库身份。
3. 从生成的 `.codex/config.toml` 读取命令和参数，启动实际 stdio MCP 服务；initialize 握手成功，发现 11 个工具。
4. `skillflux.list` 确认最初没有已安装技能。
5. `skillflux.search` 搜索 `grill-me`，`skillflux.plan` 解析 `grill-me@1.0.0` 及依赖 `grilling@1.0.0`。
6. 将实际计划 ID 传给 `skillflux.install`，两个包安装成功。
7. `skillflux.load` 返回主入口、依赖正文和请求的 `agents/openai.yaml`、`LICENSE.txt`；返回内容与本地文件逐字一致。
8. 重新核对完整文件库存、大小和 SHA-256；共 6 个内容文件、4530 字节，全部一致。
9. `skillflux.check_updates` 在线检查成功，两包均为 `current`，数据来源为 `catalog`。
10. 关闭并重新启动 MCP 服务，再次完整加载成功，自动更新状态为 `follow-compatible / current`。

## 文件核验记录

每个包还包含 Runtime 生成的 `.skillflux-manifest.json` 本地验证锚点，不计入下列原始内容文件。

| 技能 | 文件 | 字节数 | SHA-256 |
| --- | --- | ---: | --- |
| `grill-me` | `LICENSE.txt` | 1068 | `0e7ac423bf2c6e223b7c5b156f8cf72da49d748e56a1641402c31f22ad07dbb5` |
| `grill-me` | `SKILL.md` | 157 | `caaf8b8de1684f96e26b28f3c29189db5c89cce4b73e1c93d86164f66ef88637` |
| `grill-me` | `agents/openai.yaml` | 137 | `c061e39c3e0f9d865fb1b97556d485704af2a8a58f4b8221a8917a5c2074a32b` |
| `grilling` | `LICENSE.txt` | 1068 | `0e7ac423bf2c6e223b7c5b156f8cf72da49d748e56a1641402c31f22ad07dbb5` |
| `grilling` | `SKILL.md` | 1987 | `10ff989e7498b23b5acb49d5048f11dcd906757d2f79c5cdf8a00001381296f2` |
| `grilling` | `agents/openai.yaml` | 113 | `1411d7df7d99b7e621a1ff8283c8133cc2464be63d064e52d8ce169c6800ee9b` |

## 复现方式

在新建的测试文件夹中安装公开包，例如：

```sh
mkdir client project
npm install --prefix ./client --ignore-scripts --no-audit --no-fund @skillflux/mcp@1.1.0
node ./client/node_modules/@skillflux/mcp/dist/cli.js init --project ./project --repo vc999999999/skillflux-catalog --host codex --preauthorize-reviewed-text --update-policy follow-compatible
```

上例明确为测试项目启用 MCP 首次安装已审核文本包与兼容更新跟随。测试时另行指定空 npm userconfig、globalconfig、cache，并清除继承凭据。随后按生成的 MCP 配置连接 stdio 服务，依次请求：

```json
{"name":"skillflux.search","arguments":{"query":"grill-me","host":"codex"}}
{"name":"skillflux.plan","arguments":{"skillId":"grill-me","version":"1.0.0"}}
{"name":"skillflux.install","arguments":{"planId":"上一步实际返回的计划 ID"}}
{"name":"skillflux.load","arguments":{"skillId":"grill-me","resources":["agents/openai.yaml","LICENSE.txt"]}}
{"name":"skillflux.check_updates","arguments":{"force":true}}
```

## 结果边界

- 两个技能本来由 Markdown、YAML 与许可证组成；这次没有测试其他技能的 Python/Shell 执行能力。
- 验证了生成配置启动的真实 MCP 连接；没有新建 Codex 聊天验证桌面宿主自动发现，也没有执行真人需求访谈。
- 本次没有可升级版本，未发生实际版本升级。`current` 表示在线检查确认当前版本，不是升级成功的证据。
- 收录的 intake 候选不会因为这次验证进入 MCP 搜索或取得安装资格。

English summary: The public npm client installed two real catalog releases through stdio MCP from an initially empty project. All six content files matched the catalog inventory and hashes; instructions, dependency content and requested resources loaded correctly, including after a server restart. Online update checks returned current versions. No version upgrade or desktop-host discovery test occurred.
