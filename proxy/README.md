# 公告 PDF 跨域代理（Cloudflare Worker）部署指引

巨潮 `static.cninfo.com.cn` 的 CORS 是白名单制（只放行 cninfo 自家域名），
网页无法直接抓取公告 PDF。把 `worker.js` 部署到你自己的 Cloudflare 账号，
页面里填上 Worker 地址，URL 解析即可 100% 可用。免费额度（每天 10 万次请求）绰绰有余。

## 方式一：网页端部署（推荐，无需安装任何工具）

1. 打开 <https://dash.cloudflare.com/>，注册/登录（免费）。
2. 左侧菜单 **Workers 和 Pages** → **创建 Worker**（Create Worker）→ 随便起个名，如
   `share-script-pdf-proxy` → **部署**。
3. 进入该 Worker → **编辑代码**（Edit code）→ 用本目录 `worker.js` 的**全部内容**替换编辑器里的默认代码 → **部署**。
4. 你的 Worker 地址形如：`https://share-script-pdf-proxy.<你的子域>.workers.dev`。
5. 打开主持稿生成器页面，在「自建代理地址（可选）」输入框填入该地址（不含路径、不含末尾 `/`），
   页面会记住它，之后 URL 解析会优先走它。

## 方式二：命令行部署（wrangler）

```bash
cd proxy
npx wrangler login          # 首次使用：浏览器弹出 Cloudflare 授权，点 Allow
npx wrangler deploy worker.js --name share-script-pdf-proxy --compatibility-date 2024-09-25
```

部署成功后 wrangler 会输出 Worker 地址，填入页面输入框即可。

## 验证

```bash
curl -s -o /tmp/t.pdf -w "%{http_code}\n" \
  "https://<你的Worker地址>/?url=https%3A%2F%2Fstatic.cninfo.com.cn%2Ffinalpage%2F2026-09-11%2F1225557486.PDF"
file /tmp/t.pdf   # 应显示 PDF document
```

## 安全说明

- 仅允许 `https` 且主机在白名单（`static.cninfo.com.cn`、`www.cninfo.com.cn`、`webchat.cninfo.com.cn`），
  其余请求一律 403，不会被当作开放代理滥用。
- 如需代理其他披露网站，把对应主机名加进 `worker.js` 的 `ALLOWED_HOSTS` 再重新部署即可。
