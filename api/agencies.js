const express = require('express');
const { query } = require('../db');

const router = express.Router();

const VALID_SPECIALTIES = ['naver','kakao','meta','google','youtube','tiktok','coupang','smartstore','seo','content','design','data','brand'];

// 조회수 디둡 캐시 (60초 IP+slug)
const VIEW_WINDOW_MS = 60 * 1000;
const viewCache = new Map();
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.headers['x-real-ip']
      || req.socket?.remoteAddress
      || 'unknown';
}
function shouldCountView(key) {
  const now = Date.now();
  const exp = viewCache.get(key);
  if (exp && exp > now) return false;
  viewCache.set(key, now + VIEW_WINDOW_MS);
  if (viewCache.size > 20000) {
    for (const [k, v] of viewCache) {
      if (v <= now) viewCache.delete(k);
      if (viewCache.size <= 16000) break;
    }
  }
  return true;
}

// ─────────────────────────────────────────────
// GET /api/agencies — 공개 디렉토리 목록
// 필터: ?specialty=naver&size=1-5&q=keyword
// ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { specialty, size, q } = req.query;
  try {
    const where = ['is_active = TRUE'];
    const params = [];
    if (specialty && specialty !== 'all') {
      params.push('%' + specialty + '%');
      where.push(`specialties ILIKE $${params.length}`);
    }
    if (size && size !== 'all') {
      params.push(size);
      where.push(`team_size = $${params.length}`);
    }
    if (q && q.trim()) {
      params.push('%' + q.trim() + '%');
      where.push(`(name ILIKE $${params.length} OR tagline ILIKE $${params.length} OR description ILIKE $${params.length})`);
    }

    const sql = `
      SELECT id, slug, name, tagline, logo_url, specialties, location, team_size,
             founded_year, is_verified, view_count
      FROM agencies
      WHERE ${where.join(' AND ')}
      ORDER BY is_verified DESC, view_count DESC, id ASC
      LIMIT 50
    `;
    const { rows } = await query(sql, params);
    res.json({ agencies: rows });
  } catch (err) {
    console.error('[api/agencies]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/agencies/:slug — 디렉토리 상세
// ─────────────────────────────────────────────
router.get('/:slug', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM agencies WHERE slug = $1 AND is_active = TRUE`,
      [req.params.slug]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'not_found' });

    // 조회수 증가 (IP+slug 60초 디둡)
    const subject = req.user ? `u${req.user.id}` : clientIp(req);
    if (shouldCountView(`agency:${subject}:${rows[0].id}`)) {
      await query('UPDATE agencies SET view_count = view_count + 1 WHERE id = $1', [rows[0].id]);
    }

    res.json({ agency: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

// 클릭(웹사이트 이동) 트래킹
router.post('/:id/click', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  try {
    await query('UPDATE agencies SET click_count = click_count + 1 WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'failed' });
  }
});

module.exports = { router, VALID_SPECIALTIES };
