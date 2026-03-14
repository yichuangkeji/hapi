# Namespace 登录教程（新用户）

这份教程用于多用户共用一个 Hub 的场景。  
核心规则：**所有客户端都用同一个 base token，但每个人追加自己的 namespace**。

## 1. 先拿到两个信息

- Hub 地址（例如 `http://47.100.11.164:3006`）
- base token（例如 `_SZkoNfuKQOg57RPAF3-pbpLHmrcDut1a0LUcX8ihR0`）

你的登录 token 需要是：

```text
<base-token>:<your-namespace>
```

示例：

```text
_SZkoNfuKQOg57RPAF3-pbpLHmrcDut1a0LUcX8ihR0:alice
```

## 2. 安装 / 更新 hapi CLI

首次安装：

```bash
curl -fsSL https://raw.githubusercontent.com/yichuangkeji/hapi/main/scripts/install_hapi.sh | bash
```

已安装后更新：

```bash
hapi update
```

更新到指定版本：

```bash
hapi update --version v0.16.1-zqs.1
```

## 3. 本地 CLI 登录

```bash
export HAPI_API_URL="http://47.100.11.164:3006"
hapi auth logout
unset CLI_API_TOKEN
hapi auth login
```

然后输入上面的 `base:namespace` token。

## 4. 验证是否生效

```bash
hapi auth status
```

重点看：

- `HAPI_API_URL` 是否正确
- `Token Source`（建议是 `settings file`）
- `Machine ID` 是否已生成

## 5. 登录后必须启动 runner（每台机器都要执行）

```bash
hapi runner stop
hapi runner start
hapi runner status
```

说明：

- 只执行 `hapi auth login` 不够，**不启动 runner 就不会有在线机器**。
- 你有几台电脑，就要在每台电脑上各执行一次这一步。
- 如果跳过这一步，Web 的 `Create Session` 会看到 `No machines available`。

如果你希望立即开一个本地会话，也可以直接执行：

```bash
hapi
```

这会同时触发机器注册和会话启动。

## 6. Web 登录

Web 端也必须输入同一个 `base:namespace`，否则会进错工作区。

## 7. 验证机器是否已进入当前 namespace

打开 Web 的 `Create Session` 页面，`Machine` 下拉里应出现当前机器。
如果没有，回到本机再执行一次：

```bash
hapi runner stop
hapi runner start
```

## 常见问题

### Q1: 明明登录了 namespace，结果还在 default

通常是环境变量覆盖了 token。检查并清理：

```bash
echo "$CLI_API_TOKEN"
```

如果有值，删除 shell 配置里的 `export CLI_API_TOKEN=...`，再执行：

```bash
unset CLI_API_TOKEN
hapi auth logout
hapi auth login
```

### Q2: 同一台机器切换 namespace 后异常

同一机器切 namespace 时，先清本地 machineId：

```bash
hapi auth logout
```

或者给每个 namespace 使用独立 `HAPI_HOME`。
