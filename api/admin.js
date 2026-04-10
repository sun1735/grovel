/**
 * /api/admin/* — 관리자 전용 엔드포인트
 *
 * 모든 엔드포인트는 requireAdmin 미들웨어를 통과해야 한다.
 * (첫 가입자가 자동으로 admin role 받음)
 */
const express = require('express');
const { query } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(requireAdmin);

// ─────────────────────────────────────────────
// GET /api/admin/overview — 대시보드 핵심 지표
// ─────────────────────────────────────────────
router.get('/overview', async (_req, res) => {
  try {
    const { rows: counters } = await query(`
      SELECT
        (SELECT COUNT(*)::int FROM users)                                        AS users_total,
        (SELECT COUNT(*)::int FROM users WHERE created_at > NOW() - INTERVAL '24 hours') AS users_today,
        (SELECT COUNT(*)::int FROM posts)                                        AS posts_total,
        (SELECT COUNT(*)::int FROM posts WHERE published_at > NOW() - INTERVAL '24 hours') AS posts_today,
        (SELECT COUNT(*)::int FROM posts WHERE is_ai = TRUE)                     AS posts_ai,
        (SELECT COUNT(*)::int FROM posts WHERE is_ai = FALSE AND user_id IS NOT NULL) AS posts_user,
        (SELECT COUNT(*)::int FROM comments)                                     AS comments_total,
        (SELECT COUNT(*)::int FROM comments WHERE created_at > NOW() - INTERVAL '24 hours') AS comments_today,
        (SELECT COUNT(*)::int FROM topic_seeds)                                  AS topics_total,
        (SELECT COUNT(*)::int FROM topic_seeds WHERE used_count = 0)             AS topics_unused,
        (SELECT COUNT(*)::int FROM memory_threads)                               AS memories_total
    `);

    const { rows: engine } = await query(`
      SELECT
        COUNT(*)::int                                                       AS total,
        SUM(CASE WHEN success THEN 1 ELSE 0 END)::int                       AS ok,
        ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0), 1) AS rate,
        AVG(duration_ms)::int                                               AS avg_ms,
        SUM(input_tokens)::int                                              AS in_tokens,
        SUM(output_tokens)::int                                             AS out_tokens
      FROM engine_log
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `);

    res.json({ counters: counters[0], engine_24h: engine[0] });
  } catch (err) {
    console.error('[admin/overview]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/recent-posts — 최근 글 (관리/삭제용)
// ─────────────────────────────────────────────
router.get('/recent-posts', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  try {
    const { rows } = await query(`
      SELECT p.id, p.title, p.author_nickname, p.is_ai, p.persona_id, p.user_id,
             p.view_count, p.comment_count, p.published_at,
             b.name AS board_name, b.slug AS board_slug
      FROM posts p
      JOIN boards b ON b.id = p.board_id
      ORDER BY p.published_at DESC
      LIMIT $1
    `, [limit]);
    res.json({ posts: rows });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/users — 회원 목록
// ─────────────────────────────────────────────
router.get('/users', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        u.id, u.email, u.nickname, u.role, u.is_active,
        u.created_at, u.last_login_at,
        (SELECT COUNT(*)::int FROM posts WHERE user_id = u.id)    AS post_count,
        (SELECT COUNT(*)::int FROM comments WHERE user_id = u.id) AS comment_count
      FROM users u
      ORDER BY u.created_at DESC
      LIMIT 100
    `);
    res.json({ users: rows });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/memories — 페르소나 메모리 검색
// ─────────────────────────────────────────────
router.get('/memories', async (req, res) => {
  const persona = req.query.persona;
  const q = req.query.q;
  try {
    const params = [];
    let where = '';
    if (persona) {
      params.push(persona);
      where += ` WHERE persona_id = $${params.length}`;
    }
    if (q) {
      params.push('%' + q + '%');
      where += where ? ` AND (summary ILIKE $${params.length} OR topic_key ILIKE $${params.length})`
                     : ` WHERE (summary ILIKE $${params.length} OR topic_key ILIKE $${params.length})`;
    }
    const { rows } = await query(`
      SELECT id, persona_id, topic_key, summary, recall_count, created_at
      FROM memory_threads
      ${where}
      ORDER BY created_at DESC
      LIMIT 100
    `, params);
    res.json({ memories: rows });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/engine-log — LLM 호출 이력
// ─────────────────────────────────────────────
router.get('/engine-log', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT id, task_type, persona_id, board_slug, success, error_message,
             llm_model, input_tokens, output_tokens, duration_ms, created_at
      FROM engine_log
      ORDER BY created_at DESC
      LIMIT 50
    `);
    res.json({ logs: rows });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/admin/posts/:id
// ─────────────────────────────────────────────
router.delete('/posts/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  try {
    await query('DELETE FROM posts WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/admin/comments/:id
// ─────────────────────────────────────────────
router.delete('/comments/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  try {
    const { rows } = await query('SELECT post_id FROM comments WHERE id = $1', [id]);
    if (rows[0]) {
      await query('UPDATE posts SET comment_count = GREATEST(0, comment_count - 1) WHERE id = $1', [rows[0].post_id]);
    }
    await query('DELETE FROM comments WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

module.exports = router;
