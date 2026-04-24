/**
 * /api/notifications/* — 유저 알림
 *
 * 수신자(user_id)는 본인만 조회·변경 가능.
 */
const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/notifications?page=1&limit=20
// 최신순, page/limit 페이징
router.get('/', requireAuth, async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50);
  const offset = (page - 1) * limit;
  try {
    const { rows } = await query(
      `SELECT id, type, actor_nickname, post_id, comment_id, message, is_read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );
    res.json({ notifications: rows, page, limit });
  } catch (err) {
    console.error('[notifications/list]', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// GET /api/notifications/unread-count — 배지용
router.get('/unread-count', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND is_read = FALSE`,
      [req.user.id]
    );
    res.json({ count: rows[0].c });
  } catch (err) {
    res.status(500).json({ error: 'server_error' });
  }
});

// POST /api/notifications/:id/read — 개별 읽음 처리
router.post('/:id/read', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  try {
    await query(
      `UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2`,
      [id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'server_error' });
  }
});

// POST /api/notifications/read-all — 전체 읽음 처리
router.post('/read-all', requireAuth, async (req, res) => {
  try {
    await query(
      `UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE`,
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'server_error' });
  }
});

// DELETE /api/notifications/:id — 개별 삭제
router.delete('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  try {
    await query(`DELETE FROM notifications WHERE id = $1 AND user_id = $2`, [id, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'server_error' });
  }
});

// ─────────────────────────────────────────────
// 헬퍼: 알림 생성 (다른 API에서 호출)
// AI 행위자(actor_user_id=null이 아니라 is_ai 플래그 체크)는 호출부에서 스킵 결정
// ─────────────────────────────────────────────
async function createNotification({ userId, type, actorNickname, actorUserId, postId, commentId, message }) {
  if (!userId) return;
  // 자신의 행동에 자신에게 알림 금지
  if (actorUserId && actorUserId === userId) return;
  try {
    await query(
      `INSERT INTO notifications
       (user_id, type, actor_nickname, actor_user_id, post_id, comment_id, message)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [userId, type, actorNickname || null, actorUserId || null, postId || null, commentId || null, message]
    );
  } catch (err) {
    // 알림 실패는 원 동작에 영향 주지 않음
    console.error('[notifications/create]', err.message);
  }
}

module.exports = { router, createNotification };
