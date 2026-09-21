/**
 * 公告 PDF 跨域代理（Cloudflare Worker）
 * 用途：巨潮 static.cninfo.com.cn 的 CORS 白名单只放行自家域名，
 *       页面（GitHub Pages）无法直接抓取公告 PDF，经本 Worker 中转。
 * 契约：GET /?url=<encodeURIComponent(目标URL)>
 *   → 透传上游字节流，并附加 Access-Control-Allow-Origin: *
 * 安全：仅允许 https 且主机在白名单内（含重定向目标），防止成为开放代理被滥用；
 *       仅 GET/HEAD；来源 Origin 不在白名单时拒绝（无 Origin 的非浏览器请求放行）。
 * 部署：见同目录 README.md
 */

const ALLOWED_HOSTS = new Set([
  'static.cninfo.com.cn',
  'www.cninfo.com.cn',
  'webchat.cninfo.com.cn',
]);

/* 调用方来源白名单：本项目站点与本地开发；curl 等无 Origin 请求不在此限（防浏览器端盗用配额） */
const ALLOWED_ORIGINS = new Set([
  'https://nssg.cn',
  'https://swyu22.github.io',
  'http://127.0.0.1:8931',
  'http://localhost:8931',
]);

function isAllowedHost(u) {
  return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname);
}

function withCors(resp, origin) {
  const r = new Response(resp.body, resp);
  /* 上游若声明了内容编码（gzip 等），Workers 会自动解压，透传字节数随之变化：
     移除 content-encoding 防二次解压损坏，并移除 content-length 防与实际字节数不符 */
  r.headers.delete('content-encoding');
  r.headers.delete('content-length');
  r.headers.set('Access-Control-Allow-Origin', origin || '*');
  r.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', '*');
  return r;
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin');
    const corsOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://nssg.cn';
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), corsOrigin);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return withCors(Response.json({ error: 'method not allowed' }, { status: 405 }), corsOrigin);
    }
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return withCors(Response.json({ error: 'origin not allowed' }, { status: 403 }), corsOrigin);
    }
    const target = new URL(request.url).searchParams.get('url');
    if (!target) {
      return withCors(Response.json({ error: 'missing url param' }, { status: 400 }), corsOrigin);
    }
    let t;
    try {
      t = new URL(target);
    } catch {
      return withCors(Response.json({ error: 'invalid url param' }, { status: 400 }), corsOrigin);
    }
    if (!isAllowedHost(t)) {
      return withCors(Response.json({ error: 'host not allowed' }, { status: 403 }), corsOrigin);
    }
    let upstream;
    let redirects = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        upstream = await fetch(t.toString(), {
          headers: {
            /* 巨潮 WAF（2026-09 起）：要求 Referer 为自家域名，且拒绝 Chrome 形态 UA */
            'User-Agent': 'Mozilla/5.0',
            'Referer': 'https://www.cninfo.com.cn/',
            'Accept': '*/*',
          },
          redirect: 'manual',
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        return withCors(Response.json({ error: 'upstream fetch failed' }, { status: 502 }), corsOrigin);
      }
      /* 重定向：目标主机重新过白名单再跟随，防白名单被开放重定向绕过；至多 3 次防循环 */
      if (upstream.status >= 300 && upstream.status < 400) {
        const loc = upstream.headers.get('Location');
        let nt;
        try { nt = new URL(loc, t); } catch { nt = null; }
        if (!nt || !isAllowedHost(nt) || ++redirects > 3) {
          return withCors(Response.json({ error: 'redirect host not allowed' }, { status: 403 }), corsOrigin);
        }
        t = nt;
        attempt--;   /* 重定向不消耗重试次数 */
        continue;
      }
      /* 偶发按 IP 限流返回 403，稍候重试一次 */
      if (upstream.status !== 403) break;
      if (attempt === 0) await new Promise(r => setTimeout(r, 800));
    }
    return withCors(upstream, corsOrigin);
  },
};
