# Common Commands

Quick command set for daily HAPI usage.

## 1. Configure hub address

```bash
export HAPI_API_URL="http://47.100.11.164:3006"
```

## 2. Login (CLI)

```bash
hapi auth login
```

Use token format with namespace for multi-user isolation:

```text
<base-token>:<namespace>
```

Example:

```text
_SZkoNfuKQOg57RPAF3-pbpLHmrcDut1a0LUcX8ihR0:alice
```

## 3. Check auth status

```bash
hapi auth status
```

## 4. Start session

```bash
hapi
```

Or start Codex mode:

```bash
hapi codex
```

## 5. Logout (CLI)

```bash
hapi auth logout
unset CLI_API_TOKEN
```

Note: if token is exported in your shell profile (`~/.zshrc`, `~/.bashrc`), remove it there too.

## 6. Logout (Web)

Open **Settings → Account → Sign out**.

If you are on an old web build without the sign-out button, clear local token in browser console:

```js
Object.keys(localStorage)
  .filter((k) => k.startsWith('hapi_access_token::'))
  .forEach((k) => localStorage.removeItem(k));
location.reload();
```

## 7. Deploy to `aly`

Full deploy:

```bash
./scripts/deploy_aly.sh
```

Skip build and deploy current binary:

```bash
SKIP_BUILD=1 ./scripts/deploy_aly.sh
```

## 8. Build + tag + push to `zqs` release

```bash
./scripts/release_zqs.sh 0.16.2-zqs.1
```

Optional:

```bash
SKIP_BUILD=1 ./scripts/release_zqs.sh 0.16.2-zqs.1
```

## 9. One-click install / update (auto detect OS + arch)

Install latest:

```bash
curl -fsSL https://raw.githubusercontent.com/yichuangkeji/hapi/main/scripts/install_hapi.sh | bash
```

Install a specific release:

```bash
curl -fsSL https://raw.githubusercontent.com/yichuangkeji/hapi/main/scripts/install_hapi.sh | bash -s -- --version v0.16.1-zqs.1
```

## 10. One-click update from installed CLI

```bash
hapi update
```

Update to specific version:

```bash
hapi update --version v0.16.1-zqs.1
```
