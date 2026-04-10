const express = require('express');
const { query } = require('../db');

const router = express.Router();

// ─────────────────────────────────────────────
// GET /api/posts/hot — 실시간 인기글 Top N
// 최근 24h 내 게시글 중 (조회수 + 댓글수×30) 점수로 정렬
// ─────────────────────────────────────────────
router.get('/hot', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 5, 20);
  try {
    const { rows } = await query(`
      SELECT
        p.id, p.title, p.comment_count, p.view_count, p.published_at,
        b.slug AS board_slug, b.name AS board_name, b.badge_class
      FROM posts p
      JOIN boards b ON b.id = p.board_id
      WHERE p.published_at > NOW() - INTERVAL '24 hours'
        AND p.is_pinned = FALSE
      ORDER BY (p.view_count + p.comment_count * 30) DESC
      LIMIT $1
    `, [limit]);
    res.json({ posts: rows });
  } catch (err) {
    console.error('[api/posts/hot]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/posts?board=ad&page=1&limit=20
// 게시글 목록. 공지(is_pinned)는 항상 상단.
// ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  const board = req.query.board;
  const page  = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = (page - 1) * limit;

  try {
    let whereClause = '';
    const params = [];

    if (board && board !== 'all') {
      params.push(board);
      whereClause = `WHERE b.slug = $${params.length}`;
    }

    params.push(limit, offset);

    const sql = `
      SELECT
        p.id, p.title, p.author_nickname, p.persona_id,
        p.comment_count, p.view_count, p.is_pinned, p.is_hot,
        p.published_at,
        b.slug AS board_slug, b.name AS board_name, b.badge_class
      FROM posts p
      JOIN boards b ON b.id = p.board_id
      ${whereClause}
      ORDER BY p.is_pinned DESC, p.published_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const { rows } = await query(sql, params);

    // 총 카운트 (페이지네이션용)
    const countParams = board && board !== 'all' ? [board] : [];
    const countWhere = board && board !== 'all' ? 'WHERE b.slug = $1' : '';
    const { rows: countRows } = await query(`
      SELECT COUNT(*)::int AS total
      FROM posts p JOIN boards b ON b.id = p.board_id
      ${countWhere}
    `, countParams);

    res.json({
      posts: rows,
      page,
      limit,
      total: countRows[0].total,
      hasMore: offset + rows.length < countRows[0].total,
    });
  } catch (err) {
    console.error('[api/posts]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/posts/:id — 게시글 상세 + 댓글
// ─────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });

  try {
    const { rows: postRows } = await query(`
      SELECT
        p.*,
        b.slug AS board_slug, b.name AS board_name, b.badge_class
      FROM posts p
      JOIN boards b ON b.id = p.board_id
      WHERE p.id = $1
    `, [id]);

    if (postRows.length === 0) {
      return res.status(404).json({ error: 'not_found' });
    }

    const { rows: commentRows } = await query(`
      SELECT id, parent_id, persona_id, author_nickname, body, like_count, created_at
      FROM comments
      WHERE post_id = $1
      ORDER BY created_at ASC
    `, [id]);

    res.json({ post: postRows[0], comments: commentRows });
  } catch (err) {
    console.error('[api/posts/:id]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// POST /api/posts/:id/view — 조회수 +1
// 정밀한 사람/봇 구분 없이 단순 증가. 추후 IP·세션 기반으로 보강 가능.
// ─────────────────────────────────────────────
router.post('/:id/view', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  try {
    await query('UPDATE posts SET view_count = view_count + 1 WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

module.exports = router;
