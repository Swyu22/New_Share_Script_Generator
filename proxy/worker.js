/**
 * 公告 PDF 跨域代理（Cloudflare Worker）
 * 用途：巨潮 static.cninfo.com.cn 的 CORS 白名单只放行自家域名，
 *       页面（GitHub Pages）无法直接抓取公告 PDF，经本 Worker 中转。
 * 契约：GET /?url=<encodeURIComponent(目标URL)>
 *   → 透传上游字节流，并附加 Access-Control-Allow-Origin: *
 * 安全：仅允许 https 且主机在白名单内，防止成为开放代理被滥用。
 * 部署：见同目录 README.md
 */

const ALLOWED_HOSTS = new Set([
  'static.cninfo.com.cn',
  'www.cninfo.com.cn',
  'webchat.cninfo.com.cn',
]);

function withCors(resp) {
  const r = new Response(resp.body, resp);
  /* 上游若声明了内容编码（gzip 等），与透传字节可能不一致，移除防二次解压损坏 */
  r.headers.delete('content-encoding');
  r.headers.set('Access-Control-Allow-Origin', '*');
  r.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', '*');
  return r;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }
    const target = new URL(request.url).searchParams.get('url');
    if (!target) {
      return withCors(Response.json({ error: 'missing url param' }, { status: 400 }));
    }
    let t;
    try {
      t = new URL(target);
    } catch {
      return withCors(Response.json({ error: 'invalid url param' }, { status: 400 }));
    }
    if (t.protocol !== 'https:' || !ALLOWED_HOSTS.has(t.hostname)) {
      return withCors(Response.json({ error: 'host not allowed' }, { status: 403 }));
    }
    let upstream;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        upstream = await fetch(t.toString(), {
          headers: {
            /* 巨潮 WAF（2026-09 起）：要求 Referer 为自家域名，且拒绝 Chrome 形态 UA */
            'User-Agent': 'Mozilla/5.0',
            'Referer': 'https://www.cninfo.com.cn/',
            'Accept': '*/*',
          },
          redirect: 'follow',
        });
      } catch {
        return withCors(Response.json({ error: 'upstream fetch failed' }, { status: 502 }));
      }
      /* 偶发按 IP 限流返回 403，稍候重试一次 */
      if (upstream.status !== 403) break;
      if (attempt === 0) await new Promise(r => setTimeout(r, 800));
    }
    return withCors(upstream);
  },
};
