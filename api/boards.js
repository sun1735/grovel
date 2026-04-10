const express = require('express');
const { query } = require('../db');

const router = express.Router();

// GET /api/boards — 모든 게시판
router.get('/', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT b.id, b.slug, b.name, b.description, b.badge_class, b.sort_order,
             COUNT(p.id)::int AS post_count
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

module.exports = router;
