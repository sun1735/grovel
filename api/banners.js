const express = require('express');
const { query, pool } = require('../db');

const router = express.Router();

const VALID_SLOTS = ['top', 'inline', 'bottom', 'side1', 'side2'];
const MAX_PER_SLOT = 5;

// ─────────────────────────────────────────────
// GET /api/banners — 공개. 슬롯별 활성 배너 목록 반환.
// 프론트에서 slot 키로 그룹핑된 객체로 받음.
// 업로드된 이미지면 image_url을 /api/banners/:id/image로 자동 변환.
// ─────────────────────────────────────────────
router.get('/', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT id, slot, image_url, link_url, alt_text,
             (image_data IS NOT NULL) AS has_uploaded_image
      FROM banners
      WHERE is_active = TRUE
      ORDER BY slot, sort_order, id
    `);
    const grouped = {};
    for (const slot of VALID_SLOTS) grouped[slot] = [];
    for (const b of rows) {
      const url = b.has_uploaded_image
        ? `/api/banners/${b.id}/image`
        : b.image_url;
      if (grouped[b.slot]) grouped[b.slot].push({
        id: b.id, slot: b.slot, image_url: url,
        link_url: b.link_url, alt_text: b.alt_text,
      });
    }
    res.json({ banners: grouped });
  } catch (err) {
    console.error('[api/banners]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/banners/:id/image — 업로드된 이미지 바이너리 서빙
// ─────────────────────────────────────────────
router.get('/:id/image', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).end();
  try {
    const { rows } = await query(
      'SELECT image_data, image_mime FROM banners WHERE id = $1 AND is_active = TRUE',
      [id]
    );
    if (rows.length === 0 || !rows[0].image_data) {
      return res.status(404).end();
    }
    res.set('Content-Type', rows[0].image_mime || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=86400');  // 1일 캐시
    res.send(rows[0].image_data);
  } catch (err) {
    console.error('[api/banners/:id/image]', err);
    res.status(500).end();
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
