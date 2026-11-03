// ============================================================
// ysc-api · 影视仓/TVBox 自更新接口聚合服务
// 架构: 每周一凌晨3点(北京)定时采集10个上游接口 -> 校验 -> 按优先级选优存KV
//       用户地址永远不变, 内容永远是"当前最优可用接口"
// 端点: /          当前最优接口·精简版(默认, 加载快)
//       /full      当前最优接口·完整版(想要全部站点时用)
//       /status    各源健康状态与当前生效源
//       /refresh   手动触发一次采集
//       /s/0~/s/9  直通池内第N个源(备用手动切换)
//       /catpaw/*  CatPawOpen(猫爪)客户端主源包代理(仓库catpaw/, 社区kstore聚合包)
//       /catpaw-official/*  猫爪官方框架构建包(备用, 仓库catpaw-official/)
// ============================================================

const SOURCES_URL = "https://raw.githubusercontent.com/fengzhiku123/ysc-api/main/sources.json";
const REPO_RAW_BASE = "https://raw.githubusercontent.com/fengzhiku123/ysc-api/main/";
const CATPAW_DIRS = { "/catpaw/": "catpaw/", "/catpaw-official/": "catpaw-official/" };
const UA = "okhttp/3.12.13";
const STALE_MS = 180 * 3600 * 1000; // 超过7.5天未刷新(周更新+冗余)则请求时顺带刷新兜底

// ---- 精简版裁剪规则(仅作用于 / 默认端点, /full 忠实输出原版不裁) ----
// 1) 黑名单: 名称含这些关键词的站点直接裁掉(冷门分类)
//    注: 功能频道(配置中心/我的网盘等)白名单优先, 不受黑名单影响
const CUT_KEYWORDS = [
  "听书", "KTV", "电台", "戏曲", "舞曲", "跳舞", "音乐", "短剧", "漫短", "漫剧",
  "体育", "WWE", "课堂", "教育", "歌曲", "合集", "Alist", "AList", "WebDav",
  "WebDAV", "115", "Emby", "DIY",
];
// 2) 功能频道白名单(key匹配, 无条件保留): 配置中心/我的网盘是配置夸克百度等网盘账号的地方
const KEEP_KEYS = ["Wexconfig", "MyPan"];
// 2) 4K网盘类只保留这几个主力(其余"4K"字样站点裁掉)
const KEEP_4K = ["花卷", "玩偶", "原盘", "蜗牛", "盘库"];
// 3) 盘搜/聚合搜索类只留这两个
const KEEP_SEARCH = ["盘搜", "卡卡"];

// 剥掉前导 // 注释行(本生态常见格式), 返回干净JSON文本
function stripCommentLines(text) {
  let t = text.replace(/^\uFEFF/, "").trim();
  while (t.startsWith("//")) {
    const nl = t.indexOf("\n");
    if (nl === -1) return "";
    t = t.slice(nl + 1).trim();
  }
  return t;
}

function slimConfig(text) {
  try {
    const cfg = JSON.parse(stripCommentLines(text));
    if (!Array.isArray(cfg.sites)) return text;
    let seenDouban = false;
    const sites = cfg.sites.filter((s) => {
      const name = String(s.name || "");
      const key = String(s.key || "");
      // 功能频道白名单: 配置中心/我的网盘等, 无条件保留
      if (KEEP_KEYS.includes(key)) return true;
      // 豆瓣首页推荐: 只留第一个(去重)
      if (/douban/i.test(key)) { if (seenDouban) return false; seenDouban = true; return true; }
      // 黑名单
      for (const kw of CUT_KEYWORDS) if (name.includes(kw)) return false;
      // 4K类白名单
      if (name.includes("4K") && !KEEP_4K.some((k) => name.includes(k))) return false;
      // 盘搜类白名单
      if (name.includes("盘搜") || name.includes("综合")) {
        return KEEP_SEARCH.some((k) => name.includes(k));
      }
      return true;
    });
    cfg.sites = sites;
    // 提速: 剔除境外DoH(国内不可达, 拖慢域名解析)
    delete cfg.doh;
    // 提速: 剔除proxy转发规则(影视仓启动时会校验这些中转, 而中转域名在用户网络DNS不可达,
    // 导致"先检查代理再加载"; 剔除后咪咕等直播流走直连)
    if (Array.isArray(cfg.rules)) cfg.rules = cfg.rules.filter((r) => r && r.name !== "proxy");
    // 提速: 剔除壁纸API(随机二次元大图200-800KB且不稳定)与已失效的预签名台标死链
    delete cfg.wallpaper;
    delete cfg.logo;
    // 直播源替换: 精简版的 lives 指向我们自己的 /live(本机网络实测优选), /full 保留上游原版
    cfg.lives = [{ name: "直播", type: 0, url: "https://ysc.tengxuntaobao.win/live" }];
    // 提速: 剔除境外DoH(Google/Cloudflare等在国内不可达, 会拖慢APP每个域名的解析),
    // 让影视仓回退到系统DNS(国内最快); /full 保留原配置不受影响
    delete cfg.doh;
    return JSON.stringify(cfg);
  } catch (e) {
    return text; // 解析失败(lintech加密格式等)则原样返回
  }
}

// 兜底源池: 仓库 sources.json 拉取失败时使用(与仓库定稿10源完全一致)
const FALLBACK_SOURCES = [
  { name: "王二小", url: "http://new.王二小放牛娃.top", priority: 1 },
  { name: "肥猫", url: "http://肥猫.net/", priority: 2 },
  { name: "欧歌", url: "https://play.iptv365.org/欧歌/api.json", priority: 3 },
  { name: "老刘备", url: "https://raw.liucn.cc/box/m.json", priority: 4 },
  { name: "嗷呜", url: "https://9763.kstore.vip/aowu.json", priority: 5 },
  { name: "小米", url: "https://raw.githubusercontent.com/ggrrttyyiii/CatVodSpider/main/json/demo.json", priority: 6 },
  { name: "南风", url: "https://raw.githubusercontent.com/yoursmile66/TVBox/main/XC.json", priority: 7 },
  { name: "天天开心", url: "https://raw.githubusercontent.com/tmoom/ttkx/main/t.json", priority: 8 },
  { name: "老刘备用", url: "https://raw.githubusercontent.com/liu673cn/box/main/m.json", priority: 9 },
  { name: "摸鱼儿", url: "http://我不是.摸鱼儿.top", priority: 10 },
];

function fetchWithTimeout(url, ms, headers) {
  const c = new AbortController();
  const tid = setTimeout(() => c.abort(), ms);
  return fetch(url, { headers: headers || { "user-agent": UA }, redirect: "follow", signal: c.signal })
    .finally(() => clearTimeout(tid));
}

function validateConfig(text) {
  if (!text) return "empty";
  const t = stripCommentLines(text);
  if (t.startsWith("{")) {
    if (t.length < 800) return "too-small";
    if (!t.includes('"sites"')) return "no-sites";
    return null; // 标准JSON接口
  }
  // lintech 加密接口(hex串, 影视仓原生解密)
  if (/^[0-9a-f]{40,}$/i.test(t.slice(0, 64)) && t.length > 4000) return null;
  return "not-config";
}

async function fetchSource(s, timeout) {
  const t0 = Date.now();
  try {
    const r = await fetchWithTimeout(s.url, timeout || 20000);
    if (!r.ok) return { ...s, ok: false, err: "HTTP " + r.status };
    const text = await r.text();
    const err = validateConfig(text);
    if (err) return { ...s, ok: false, err, size: text.length };
    return { ...s, ok: true, text, size: text.length, ms: Date.now() - t0 };
  } catch (e) {
    return { ...s, ok: false, err: String((e && e.message) || e).slice(0, 90) };
  }
}

async function getSources() {
  try {
    const r = await fetchWithTimeout(SOURCES_URL, 15000, { "user-agent": UA });
    if (r.ok) {
      const list = await r.json();
      if (Array.isArray(list) && list.length >= 3) return list;
    }
  } catch (e) { /* fall back */ }
  return FALLBACK_SOURCES;
}

async function refresh(env) {
  const sources = await getSources();
  const results = await Promise.all(sources.map((s) => fetchSource(s)));
  const ok = results.filter((r) => r.ok).sort((a, b) => (a.priority - b.priority) || (b.size - a.size));
  const meta = {
    fetchedAt: new Date().toISOString(),
    okCount: ok.length,
    winner: ok[0] ? { name: ok[0].name, url: ok[0].url, size: ok[0].size, ms: ok[0].ms || 0 } : null,
    sources: results.map((r) => ({
      name: r.name, url: r.url, priority: r.priority, ok: r.ok,
      size: r.size || 0, ms: r.ms || 0, err: r.err || null,
    })),
  };
  if (env && env.KV) {
    await env.KV.put("meta", JSON.stringify(meta));
    if (ok[0]) await env.KV.put("config", ok[0].text);
  }
  return { meta, text: ok[0] ? ok[0].text : null };
}

function jres(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}

function raw(text) {
  return new Response(text, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=300",
    },
  });
}

export default {
  async scheduled(event, env, ctx) {
    await refresh(env);
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = (url.pathname.replace(/\/+$/, "") || "/").toLowerCase();

    if (p === "/status") {
      let meta = null;
      try { meta = JSON.parse((await env.KV.get("meta")) || "null"); } catch (e) {}
      if (!meta) { const r = await refresh(env); return jres(r.meta); }
      return jres(meta);
    }
    if (p === "/refresh") {
      const r = await refresh(env);
      return jres({ refreshed: true, winner: r.meta.winner, okCount: r.meta.okCount });
    }
    // 直播源(Guovin引擎每周生成, 酒店源+订阅源全量实测速度排序后的IPv4结果)
    const LIVE_FILES = { "/live": "live/live.m3u", "/live.m3u": "live/live.m3u", "/live.md5": "live/live.m3u.md5" };
    if (LIVE_FILES[p]) {
      try {
        const r = await fetchWithTimeout(REPO_RAW_BASE + LIVE_FILES[p], 60000);
        if (!r.ok) return jres({ error: "live upstream HTTP " + r.status }, 502);
        const buf = await r.arrayBuffer();
        const ct = p === "/live.md5" ? "text/plain; charset=utf-8" : "application/x-mpegurl; charset=utf-8";
        return new Response(buf, {
          headers: {
            "content-type": ct,
            "access-control-allow-origin": "*",
            "cache-control": "public, max-age=1800",
          },
        });
      } catch (e) {
        return jres({ error: String((e && e.message) || e).slice(0, 80) }, 502);
      }
    }
    // CatPawOpen(猫爪)客户端: 主源=社区kstore聚合包, 备用=官方框架构建包
    const cpKey = Object.keys(CATPAW_DIRS).find((k) => p.startsWith(k));
    if (cpKey) {
      const file = url.pathname.slice(cpKey.length);
      if (!/^[\w.-]+$/.test(file) || file.length > 60) return jres({ error: "bad file name" }, 400);
      try {
        const r = await fetchWithTimeout(REPO_RAW_BASE + CATPAW_DIRS[cpKey] + file, 60000);
        if (!r.ok) return jres({ error: "upstream HTTP " + r.status, file: file }, 502);
        const buf = await r.arrayBuffer();
        const ct = file.endsWith(".js") ? "application/javascript; charset=utf-8" : "text/plain; charset=utf-8";
        return new Response(buf, {
          headers: {
            "content-type": ct,
            "access-control-allow-origin": "*",
            "cache-control": "public, max-age=600",
          },
        });
      } catch (e) {
        return jres({ error: String((e && e.message) || e).slice(0, 80) }, 502);
      }
    }
    const m = p.match(/^\/s\/(\d+)$/);
    if (m) {
      const sources = await getSources();
      const i = parseInt(m[1], 10);
      if (!sources[i]) return jres({ error: "源不存在 #" + i, count: sources.length }, 404);
      const r = await fetchSource(sources[i], 25000);
      return r.ok ? raw(r.text) : jres({ error: r.err, name: r.name }, 502);
    }
    if (p === "/" || p === "/index.html" || p === "/tv" || p === "/json" || p === "/full" || p === "/lite") {
      let cfg = null, meta = null;
      try {
        cfg = await env.KV.get("config");
        meta = JSON.parse((await env.KV.get("meta")) || "null");
      } catch (e) {}
      let stale = !meta || !meta.fetchedAt ||
        Date.now() - Date.parse(meta.fetchedAt) > STALE_MS;
      if (!cfg || stale) {
        const r = await refresh(env);
        if (r.text) cfg = r.text;
      }
      if (!cfg) {
        return jres({ error: "所有源暂时不可用, 请稍后重试; 可访问 /status 查看详情, 或用 /s/0~/s/9 直连各源" }, 503);
      }
      // /full 输出完整版; 其余(/ 等)输出精简版(加载快)
      if (p === "/full") return raw(cfg);
      return raw(slimConfig(cfg));
    }
    return jres({ error: "not found", endpoints: ["/(精简版)", "/full(完整版)", "/live(直播源)", "/status", "/refresh", "/s/0-9", "/catpaw/*(猫爪主源)", "/catpaw-official/*(猫爪备用源)" ] }, 404);
  },
};
