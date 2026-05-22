const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/boards — 모든 게시판 (로그인 시 즐겨찾기 표시 포함)
router.get('/', async (req, res) => {
  try {
    if (req.user) {
      const { rows } = await query(`
        SELECT b.id, b.slug, b.name, b.description, b.badge_class, b.sort_order,
               (SELECT COUNT(*)::int FROM posts WHERE board_id = b.id) AS post_count,
               (SELECT EXISTS(SELECT 1 FROM board_favorites WHERE user_id = $1 AND board_id = b.id)) AS is_favorite
        FROM boards b
        ORDER BY b.sort_order
      `, [req.user.id]);
      return res.json({ boards: rows });
    }
    const { rows } = await query(`
      SELECT b.id, b.slug, b.name, b.description, b.badge_class, b.sort_order,
             COUNT(p.id)::int AS post_count,
             FALSE AS is_favorite
      FROM boards b
      LEFT JOIN posts p ON p.board_id = b.id
      GROUP BY b.id
      ORDER BY b.sort_order
    `);
    res.json({ boards: rows });
  } catch (err) {
    console.error('[api/boards]', err);
    res.status(500).json({ error: 'failed_to_load_boards' });
  }
});

// POST /api/boards/:slug/favorite — 즐겨찾기 토글
router.post('/:slug/favorite', requireAuth, async (req, res) => {
  try {
    const { rows: b } = await query('SELECT id FROM boards WHERE slug = $1', [req.params.slug]);
    if (b.length === 0) return res.status(404).json({ error: 'not_found' });
    const boardId = b[0].id;
    const { rowCount: inserted } = await query(
      `INSERT INTO board_favorites (user_id, board_id) VALUES ($1, $2)
       ON CONFLICT (user_id, board_id) DO NOTHING`,
      [req.user.id, boardId]
    );
    if (inserted > 0) return res.json({ favorite: true });
    await query('DELETE FROM board_favorites WHERE user_id = $1 AND board_id = $2',
      [req.user.id, boardId]);
    res.json({ favorite: false });
  } catch (err) {
    console.error('[boards/favorite]', err);
    res.status(500).json({ error: 'failed' });
  }
});

module.exports = router;
