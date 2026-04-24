/**
 * /api/admin/* — 관리자 전용 엔드포인트
 *
 * 모든 엔드포인트는 requireAdmin 미들웨어를 통과해야 한다.
 * (첫 가입자가 자동으로 admin role 받음)
 */
const express = require('express');
const multer = require('multer');
const { query } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { VALID_SLOTS, MAX_PER_SLOT } = require('./banners');

const router = express.Router();

router.use(requireAdmin);

// ── 멀티파트 업로드 설정 (메모리, 5MB, 이미지만) ──
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },  // 5MB
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp|svg\+xml)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('이미지 파일만 업로드 가능합니다 (jpg/png/gif/webp/svg)'));
  },
});

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

// ─────────────────────────────────────────────
// 신고 관리
// ─────────────────────────────────────────────
router.get('/reports', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT r.*, u.nickname AS reporter_name
      FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
      ORDER BY r.status = 'pending' DESC, r.created_at DESC
      LIMIT 50
    `);
    res.json({ reports: rows });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

router.put('/reports/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { status } = req.body || {};
  if (!['resolved', 'dismissed'].includes(status)) return res.status(400).json({ error: 'invalid_status' });
  try {
    await query('UPDATE reports SET status = $2 WHERE id = $1', [id, status]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// 배너 관리
// ─────────────────────────────────────────────

// GET /api/admin/banners — 전체 배너 (비활성 포함)
router.get('/banners', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT id, slot, image_url, link_url, alt_text, sort_order, is_active, click_count, created_at
      FROM banners ORDER BY slot, sort_order, id
    `);
    res.json({ banners: rows, slots: VALID_SLOTS, max_per_slot: MAX_PER_SLOT });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

// POST /api/admin/banners — 새 배너 생성 (URL 또는 파일 업로드)
// multer가 multipart/form-data를 파싱해 req.file에 넣어줌. JSON 요청은 그대로 통과.
router.post('/banners', upload.single('image'), async (req, res) => {
  const { slot, image_url, link_url, alt_text, sort_order } = req.body || {};
  if (!slot) return res.status(400).json({ error: 'missing_slot' });
  if (!VALID_SLOTS.includes(slot)) return res.status(400).json({ error: 'invalid_slot' });

  // 이미지: 파일 OR URL 중 하나 필수
  const hasFile = !!req.file;
  if (!hasFile && !image_url) {
    return res.status(400).json({ error: 'missing_image', message: '이미지 파일을 업로드하거나 URL을 입력해 주세요.' });
  }
  if (image_url && !/^https?:\/\//.test(image_url)) {
    return res.status(400).json({ error: 'invalid_image_url', message: '이미지 URL은 http(s)://로 시작해야 합니다.' });
  }
  if (link_url && !/^https?:\/\//.test(link_url)) {
    return res.status(400).json({ error: 'invalid_link_url', message: '링크 URL은 http(s)://로 시작해야 합니다.' });
  }

  try {
    // 슬롯당 활성 배너 5개 제한
    const { rows: countRows } = await query(
      'SELECT COUNT(*)::int AS c FROM banners WHERE slot = $1 AND is_active = TRUE',
      [slot]
    );
    if (countRows[0].c >= MAX_PER_SLOT) {
      return res.status(400).json({
        error: 'slot_full',
        message: `이 슬롯엔 이미 ${MAX_PER_SLOT}개의 활성 배너가 있습니다. 기존 배너를 비활성화하거나 삭제하세요.`,
      });
    }

    const { rows } = await query(
      `INSERT INTO banners (slot, image_url, image_data, image_mime, link_url, alt_text, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, slot, image_url, link_url, alt_text, sort_order, is_active, click_count, created_at,
                 (image_data IS NOT NULL) AS has_uploaded_image`,
      [
        slot,
        hasFile ? null : image_url,
        hasFile ? req.file.buffer : null,
        hasFile ? req.file.mimetype : null,
        link_url || null,
        alt_text || null,
        parseInt(sort_order) || 0,
      ]
    );
    res.status(201).json({ banner: rows[0] });
  } catch (err) {
    console.error('[admin/banners/create]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// multer 에러 (파일 크기 초과 등)를 JSON으로 반환
router.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: 'upload_error', message: err.message });
  }
  if (err && err.message?.includes('이미지 파일만')) {
    return res.status(400).json({ error: 'invalid_file_type', message: err.message });
  }
  next(err);
});

// PUT /api/admin/banners/:id — 수정
router.put('/banners/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });

  const { image_url, link_url, alt_text, sort_order, is_active } = req.body || {};

  if (image_url && !/^https?:\/\//.test(image_url)) {
    return res.status(400).json({ error: 'invalid_image_url' });
  }
  if (link_url && !/^https?:\/\//.test(link_url)) {
    return res.status(400).json({ error: 'invalid_link_url' });
  }

  try {
    const { rows } = await query(
      `UPDATE banners SET
        image_url  = COALESCE($2, image_url),
        link_url   = $3,
        alt_text   = $4,
        sort_order = COALESCE($5, sort_order),
        is_active  = COALESCE($6, is_active),
        updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, image_url, link_url, alt_text, sort_order, is_active]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ banner: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

// DELETE /api/admin/banners/:id
router.delete('/banners/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  try {
    await query('DELETE FROM banners WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// 광고대행사 디렉토리 관리
// ─────────────────────────────────────────────
function slugify(name) {
  return name.toString().toLowerCase().trim()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'agency-' + Date.now();
}

router.get('/agencies', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT id, slug, name, tagline, specialties, location, team_size,
             is_verified, is_active, view_count, click_count, created_at
      FROM agencies ORDER BY id DESC
    `);
    res.json({ agencies: rows });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

router.post('/agencies', async (req, res) => {
  const a = req.body || {};
  if (!a.name) return res.status(400).json({ error: 'missing_name' });
  try {
    const slug = a.slug || slugify(a.name);
    const { rows } = await query(
      `INSERT INTO agencies
        (slug, name, tagline, description, logo_url, specialties, location, team_size,
         founded_year, contact_email, contact_phone, website_url, is_verified, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        slug, a.name, a.tagline || null, a.description || null, a.logo_url || null,
        a.specialties || null, a.location || null, a.team_size || null,
        a.founded_year ? parseInt(a.founded_year) : null,
        a.contact_email || null, a.contact_phone || null, a.website_url || null,
        a.is_verified === true || a.is_verified === 'true',
        a.is_active !== false && a.is_active !== 'false',
      ]
    );
    res.status(201).json({ agency: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'duplicate_slug' });
    console.error('[admin/agencies/create]', err);
    res.status(500).json({ error: 'failed' });
  }
});

router.put('/agencies/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const a = req.body || {};
  try {
    const { rows } = await query(
      `UPDATE agencies SET
        name          = COALESCE($2, name),
        tagline       = $3,
        description   = $4,
        logo_url      = $5,
        specialties   = $6,
        location      = $7,
        team_size     = $8,
        founded_year  = $9,
        contact_email = $10,
        contact_phone = $11,
        website_url   = $12,
        is_verified   = COALESCE($13, is_verified),
        is_active     = COALESCE($14, is_active),
        updated_at    = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id, a.name, a.tagline, a.description, a.logo_url,
        a.specialties, a.location, a.team_size,
        a.founded_year ? parseInt(a.founded_year) : null,
        a.contact_email, a.contact_phone, a.website_url,
        typeof a.is_verified === 'boolean' ? a.is_verified : null,
        typeof a.is_active === 'boolean' ? a.is_active : null,
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ agency: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

router.delete('/agencies/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  try {
    await query('DELETE FROM agencies WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'failed' });
  }
});

module.exports = router;
