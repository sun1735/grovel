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

// ─────────────────────────────────────────────
// GET /api/search/trending — 실시간 인기 키워드
// 최근 48시간 인기글 제목에서 빈도 높은 2-4글자 단어 추출
// ─────────────────────────────────────────────
router.get('/trending', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT title FROM posts
      WHERE published_at > NOW() - INTERVAL '48 hours'
      ORDER BY (view_count + comment_count * 30) DESC
      LIMIT 30
    `);

    // 제목에서 키워드 추출 (2-6글자 한글 단어)
    const wordCount = {};
    const stopWords = new Set(['이거','저거','그거','이건','저건','그건','진짜','완전',
      '어떻게','있으면','없으면','하는데','해봤는데','아닌가','인가요','아시는','해야','되는',
      '해주세요','해봤습니다','있나요','할까요','인데요','같은','좀','더','안','못','다','또',
      '제일','가장','모든','이번','오늘','어제','최근','지금']);

    for (const { title } of rows) {
      // 한글 2-6글자 단어 추출
      const words = title.match(/[가-힣]{2,6}/g) || [];
      for (const w of words) {
        if (stopWords.has(w)) continue;
        wordCount[w] = (wordCount[w] || 0) + 1;
      }
    }

    const trending = Object.entries(wordCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([keyword, count], i) => ({ rank: i + 1, keyword, count }));

    res.json({ trending, updated_at: new Date().toISOString() });
  } catch (err) {
    console.error('[api/search/trending]', err);
    res.status(500).json({ error: 'failed' });
  }
});

module.exports = router;
