const express = require('express');
const { query } = require('../db');

const router = express.Router();

// ─────────────────────────────────────────────
// GET /api/search?q=키워드&board=ad&page=1
// 제목·본문·작성자에서 검색. ILIKE 기반 (간단/한국어 OK).
// 추후 pg_trgm 또는 PGroonga로 업그레이드 가능.
// ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  const board = req.query.board;
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = (page - 1) * limit;

  if (!q || q.length < 2) {
    return res.json({ posts: [], total: 0, page, q, message: '검색어는 2자 이상 입력해 주세요.' });
  }

  try {
    const params = ['%' + q + '%'];
    let where = `(p.title ILIKE $1 OR p.body ILIKE $1 OR p.author_nickname ILIKE $1)`;

    if (board && board !== 'all') {
      params.push(board);
      where += ` AND b.slug = $${params.length}`;
    }

    // 카운트
    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total
       FROM posts p JOIN boards b ON b.id = p.board_id
       WHERE ${where}`,
      params
    );

    // 결과 — 제목 매치 우선, 그 다음 최신순
    params.push(limit, offset);
    const { rows } = await query(
      `SELECT
         p.id, p.title, p.body,
         SUBSTRING(p.body, 1, 200) AS excerpt,
         p.author_nickname, p.persona_id,
         p.comment_count, p.view_count, p.published_at,
         b.slug AS board_slug, b.name AS board_name, b.badge_class
       FROM posts p
       JOIN boards b ON b.id = p.board_id
       WHERE ${where}
       ORDER BY
         (CASE WHEN p.title ILIKE $1 THEN 0 ELSE 1 END),
         p.published_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      posts: rows,
      total: countRows[0].total,
      page, limit, q,
      hasMore: offset + rows.length < countRows[0].total,
    });
  } catch (err) {
    console.error('[api/search]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/search/suggest?q=키워드
// 빠른 자동완성 — 제목 매치 상위 8개 반환
// ─────────────────────────────────────────────
router.get('/suggest', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ suggestions: [] });

  try {
    const { rows } = await query(
      `SELECT p.id, p.title, b.slug AS board_slug, b.name AS board_name
       FROM posts p
       JOIN boards b ON b.id = p.board_id
       WHERE p.title ILIKE $1
       ORDER BY p.published_at DESC
       LIMIT 8`,
      ['%' + q + '%']
    );
    res.json({ suggestions: rows });
  } catch (err) {
    console.error('[api/search/suggest]', err);
    res.status(500).json({ error: 'failed' });
  }
});

module.exports = router;
