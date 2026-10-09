// Cloudflare Worker：负责静态资源调度与复盘数据接口（KV 持久化）
const KV_KEY = 'reviews';
const MAX_RECORDS = 20000;
const MAX_BODY_CHARS = 2 * 1024 * 1024;
const MOODS = ['平静', '澄明', '感恩', '锐意', '承重', '柔软'];
const SUMMARY_MODES = ['demo', 'manual', 'edited'];

const jsonReply = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

const clampText = (value, limit) => (typeof value === 'string' && value ? value.slice(0, limit) : '');

// 恒定时间比较，避免时序侧信道
function tokenMatches(request, env) {
  const expected = env.REVIEW_TOKEN || '';
  if (!expected) return false;
  const provided = request.headers.get('x-review-token') || '';
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// 只保留合法字段的记录，长度与取值和前端约定一致
function sanitizeRecord(input) {
  if (!input || typeof input !== 'object') return null;
  const date = typeof input.date === 'string' ? input.date : '';
  const original = clampText(input.original, 12000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !original.trim()) return null;
  return {
    date,
    ring: Number.isInteger(input.ring) && input.ring > 0 ? input.ring : 0,
    title: clampText(input.title, 60) || '今日回响',
    original,
    summary: clampText(input.summary, 2000),
    summaryMode: SUMMARY_MODES.includes(input.summaryMode) ? input.summaryMode : 'manual',
    mood: MOODS.includes(input.mood) ? input.mood : '',
    tomorrow: clampText(input.tomorrow, 240),
    updatedAt: clampText(input.updatedAt, 40) || new Date().toISOString()
  };
}

async function readReviews(env) {
  const value = await env.REVIEW_KV.get(KV_KEY, 'json');
  return Array.isArray(value) ? value.filter((item) => item && typeof item.date === 'string' && typeof item.original === 'string') : [];
}

// 按日期 upsert，同一日期保留 updatedAt 较新的版本（最后写入优先）
async function upsertReviews(env, incoming) {
  const list = await readReviews(env);
  let changed = false;
  for (const raw of incoming) {
    const record = sanitizeRecord(raw);
    if (!record) continue;
    const index = list.findIndex((item) => item.date === record.date);
    if (index === -1) { list.push(record); changed = true; }
    else if (String(list[index].updatedAt || '') <= String(record.updatedAt)) { list[index] = record; changed = true; }
  }
  if (!changed) return list;
  list.sort((a, b) => a.date.localeCompare(b.date));
  const next = list.length > MAX_RECORDS ? list.slice(-MAX_RECORDS) : list;
  await env.REVIEW_KV.put(KV_KEY, JSON.stringify(next));
  return next;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // 非 /api 请求交给静态资源
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!tokenMatches(request, env)) {
      return jsonReply(401, { error: 'unauthorized', message: '访问令牌缺失或不正确，或服务端尚未配置 REVIEW_TOKEN。' });
    }
    if (url.pathname !== '/api/reviews') return jsonReply(404, { error: 'not found' });
    if (request.method === 'GET') return jsonReply(200, { reviews: await readReviews(env) });
    if (request.method === 'POST') {
      const text = await request.text();
      if (text.length > MAX_BODY_CHARS) return jsonReply(413, { error: 'payload too large' });
      let parsed;
      try { parsed = JSON.parse(text); } catch { return jsonReply(400, { error: 'invalid json' }); }
      const incoming = Array.isArray(parsed) ? parsed : [parsed];
      if (!incoming.length) return jsonReply(400, { error: 'empty payload' });
      const reviews = await upsertReviews(env, incoming);
      return jsonReply(200, { ok: true, reviews });
    }
    return jsonReply(405, { error: 'method not allowed' });
  }
};
