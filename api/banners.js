const express = require('express');
const { query } = require('../db');

const router = express.Router();

const VALID_SLOTS = ['top', 'inline', 'bottom', 'side1', 'side2'];
const MAX_PER_SLOT = 5;

// ─────────────────────────────────────────────
// GET /api/banners — 공개. 슬롯별 활성 배너 목록 반환.
// 프론트에서 slot 키로 그룹핑된 객체로 받음.
// ─────────────────────────────────────────────
router.get('/', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT id, slot, image_url, link_url, alt_text
      FROM banners
      WHERE is_active = TRUE
      ORDER BY slot, sort_order, id
    `);
    const grouped = {};
    for (const slot of VALID_SLOTS) grouped[slot] = [];
    for (const b of rows) {
      if (grouped[b.slot]) grouped[b.slot].push(b);
    }
    res.json({ banners: grouped });
  } catch (err) {
    console.error('[api/banners]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// POST /api/banners/:id/click — 클릭 카운트 +1 (공개)
// ─────────────────────────────────────────────
router.post('/:id/click', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  try {
    await query('UPDATE banners SET click_count = click_count + 1 WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

module.exports = { router, VALID_SLOTS, MAX_PER_SLOT };
