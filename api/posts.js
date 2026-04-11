const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

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
  const platform = req.query.platform;
  const page  = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = (page - 1) * limit;

  try {
    const where = [];
    const params = [];

    if (board && board !== 'all') {
      params.push(board);
      where.push(`b.slug = $${params.length}`);
    }
    if (platform && platform !== 'all') {
      params.push(platform);
      where.push(`p.platform = $${params.length}`);
    }
    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    params.push(limit, offset);

    const sql = `
      SELECT
        p.id, p.title, p.author_nickname, p.persona_id, p.platform,
        p.comment_count, p.view_count, p.is_pinned, p.is_hot,
        p.published_at, p.metadata,
        b.slug AS board_slug, b.name AS board_name, b.badge_class
      FROM posts p
      JOIN boards b ON b.id = p.board_id
      ${whereClause}
      ORDER BY p.is_pinned DESC, p.published_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const { rows } = await query(sql, params);

    // 총 카운트 (페이지네이션용)
    const countParams = params.slice(0, params.length - 2);
    const { rows: countRows } = await query(`
      SELECT COUNT(*)::int AS total
      FROM posts p JOIN boards b ON b.id = p.board_id
      ${whereClause}
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

// ─────────────────────────────────────────────
// POST /api/posts — 유저가 글 작성 (인증 필수)
// body: { board_slug, title, body }
// ─────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const { board_slug, title, body, metadata } = req.body || {};
  if (!board_slug || !title || !body) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (title.length < 4 || title.length > 200) {
    return res.status(400).json({ error: 'invalid_title' });
  }
  if (body.length < 5 || body.length > 8000) {
    return res.status(400).json({ error: 'invalid_body' });
  }

  try {
    const { rows: boardRows } = await query('SELECT id FROM boards WHERE slug = $1', [board_slug]);
    if (boardRows.length === 0) return res.status(400).json({ error: 'invalid_board' });

    // 도배 방지
    const { rows: recent } = await query(
      `SELECT id FROM posts WHERE user_id = $1 AND published_at > NOW() - INTERVAL '60 seconds' LIMIT 1`,
      [req.user.id]
    );
    if (recent.length > 0) {
      return res.status(429).json({ error: 'too_fast', message: '잠시 후 다시 시도해 주세요.' });
    }

    // 구인/협업 보드면 metadata 검증
    let cleanedMeta = null;
    if (board_slug === 'job' && metadata && typeof metadata === 'object') {
      cleanedMeta = {
        budget:    String(metadata.budget || '').slice(0, 64),
        duration:  String(metadata.duration || '').slice(0, 64),
        category:  String(metadata.category || '').slice(0, 32),
        deadline:  String(metadata.deadline || '').slice(0, 32),
        location:  String(metadata.location || '').slice(0, 64),
        contact:   String(metadata.contact || '').slice(0, 128),
      };
    }

    const { rows } = await query(
      `INSERT INTO posts
        (board_id, user_id, author_nickname, title, body, view_count, is_ai, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,FALSE,$7)
       RETURNING id, published_at`,
      [boardRows[0].id, req.user.id, req.user.nickname, title.trim(), body.trim(), 0, cleanedMeta]
    );
    res.status(201).json({ post: rows[0] });
  } catch (err) {
    console.error('[posts/create]', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/posts/:id/comments — 유저가 댓글 작성 (인증 필수)
// body: { body, parent_id? }
// ─────────────────────────────────────────────
router.post('/:id/comments', requireAuth, async (req, res) => {
  const postId = parseInt(req.params.id);
  if (!postId) return res.status(400).json({ error: 'invalid_id' });

  const { body, parent_id } = req.body || {};
  if (!body || body.trim().length < 2 || body.length > 1000) {
    return res.status(400).json({ error: 'invalid_body' });
  }

  try {
    // 글 존재 확인
    const { rows: postRows } = await query('SELECT id FROM posts WHERE id = $1', [postId]);
    if (postRows.length === 0) return res.status(404).json({ error: 'post_not_found' });

    // 도배 방지: 같은 유저가 최근 15초 안에 댓글 작성한 적 있으면 거부
    const { rows: recent } = await query(
      `SELECT id FROM comments
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '15 seconds'
       LIMIT 1`,
      [req.user.id]
    );
    if (recent.length > 0) {
      return res.status(429).json({ error: 'too_fast' });
    }

    const { rows } = await query(
      `INSERT INTO comments (post_id, parent_id, user_id, author_nickname, body, is_ai)
       VALUES ($1,$2,$3,$4,$5,FALSE)
       RETURNING id, created_at`,
      [postId, parent_id || null, req.user.id, req.user.nickname, body.trim()]
    );

    await query('UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1', [postId]);

    res.status(201).json({ comment: rows[0] });
  } catch (err) {
    console.error('[comments/create]', err);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
