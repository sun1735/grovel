const express = require('express');
const { query } = require('../db');

const router = express.Router();

const VALID_CATEGORIES = ['copy-pack','checklist','cheatsheet','workbook','glossary'];

// ─────────────────────────────────────────────
// GET /api/resources?category=checklist
// ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { category } = req.query;
  try {
    const params = [];
    let where = 'WHERE is_active = TRUE';
    if (category && category !== 'all' && VALID_CATEGORIES.includes(category)) {
      params.push(category);
      where += ` AND category = $${params.length}`;
    }
    const { rows } = await query(`
      SELECT id, slug, title, subtitle, category, description, cover_gradient,
             read_time, view_count, download_count, is_featured, created_at
      FROM resources
      ${where}
      ORDER BY is_featured DESC, created_at DESC
    `, params);
    res.json({ resources: rows, categories: VALID_CATEGORIES });
  } catch (err) {
    console.error('[api/resources]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/resources/:slug — 상세
// ─────────────────────────────────────────────
router.get('/:slug', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM resources WHERE slug = $1 AND is_active = TRUE`,
      [req.params.slug]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
    // 조회수 +1
    await query('UPDATE resources SET view_count = view_count + 1 WHERE id = $1', [rows[0].id]);
    res.json({ resource: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

// 다운로드 카운트
router.post('/:id/download', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  try {
    await query('UPDATE resources SET download_count = download_count + 1 WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'failed' });
  }
});

module.exports = { router, VALID_CATEGORIES };
