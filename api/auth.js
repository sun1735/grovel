/**
 * /api/auth/* — 회원가입·로그인·로그아웃·내 정보
 *
 * - 첫 번째 가입자는 자동으로 admin 역할
 * - 비밀번호: bcryptjs (12 rounds)
 * - 세션: JWT httpOnly cookie 30일
 */
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const {
  signToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
} = require('../middleware/auth');
const { notifyNewUser, notifyError } = require('../worker/discord');

const router = express.Router();

const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NICK_RE     = /^[가-힣a-zA-Z0-9_]{2,20}$/;
const PWD_MIN     = 8;

// 마케톡 관련 닉네임 금지 (운영자 사칭 방지)
const BLOCKED_NICKS = [
  '마케톡', 'marketalk', 'marketok', '마켓톡', '관리자', '운영자', '운영팀',
  'admin', 'administrator', 'moderator', 'mod', '그로벨', 'grovel',
];
function isBlockedNickname(nick) {
  const lower = nick.toLowerCase().replace(/[\s_\-]/g, '');
  return BLOCKED_NICKS.some(b => lower.includes(b.toLowerCase()));
}

// ─────────────────────────────────────────────
// POST /api/auth/register
// ─────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { email, nickname, password } = req.body || {};

  // 검증
  if (!email || !nickname || !password) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'invalid_email' });
  }
  if (!NICK_RE.test(nickname)) {
    return res.status(400).json({ error: 'invalid_nickname', message: '닉네임은 한글/영문/숫자/_ 2-20자' });
  }
  if (isBlockedNickname(nickname)) {
    return res.status(400).json({ error: 'blocked_nickname', message: '마케톡/관리자 관련 닉네임은 사용할 수 없습니다.' });
  }
  if (password.length < PWD_MIN) {
    return res.status(400).json({ error: 'weak_password', message: `비밀번호는 ${PWD_MIN}자 이상` });
  }

  try {
    // 이메일/닉네임 중복 체크
    const dup = await query(
      'SELECT id FROM users WHERE email = $1 OR nickname = $2 LIMIT 1',
      [email.toLowerCase(), nickname]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'duplicate', message: '이미 사용 중인 이메일 또는 닉네임입니다.' });
    }

    // 첫 가입자면 admin
    const { rows: countRows } = await query('SELECT COUNT(*)::int AS c FROM users');
    const role = countRows[0].c === 0 ? 'admin' : 'user';

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await query(
      `INSERT INTO users (email, nickname, password_hash, role)
       VALUES ($1,$2,$3,$4)
       RETURNING id, email, nickname, role, created_at`,
      [email.toLowerCase(), nickname, hash, role]
    );
    const user = rows[0];

    const token = signToken(user);
    setSessionCookie(res, token);

    // 디스코드 관리자 알림
    notifyNewUser({ nickname: user.nickname, email: user.email, role: user.role }).catch(() => {});

    res.status(201).json({ user });
  } catch (err) {
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'missing_fields' });

  try {
    const { rows } = await query(
      'SELECT id, email, nickname, password_hash, role, is_active FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const token = signToken(user);
    setSessionCookie(res, token);
    res.json({
      user: { id: user.id, email: user.email, nickname: user.nickname, role: user.role }
    });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/logout
// ─────────────────────────────────────────────
router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ─────────────────────────────────────────────
// GET /api/auth/me — 현재 로그인 상태
// ─────────────────────────────────────────────
router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: req.user });
});

// ─────────────────────────────────────────────
// POST /api/auth/find-email — 아이디(이메일) 찾기
// 닉네임으로 마스킹된 이메일 반환
// ─────────────────────────────────────────────
router.post('/find-email', async (req, res) => {
  const { nickname } = req.body || {};
  if (!nickname) return res.status(400).json({ error: 'missing_nickname' });

  try {
    const { rows } = await query(
      'SELECT email FROM users WHERE nickname = $1 AND is_active = TRUE',
      [nickname]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'not_found', message: '해당 닉네임의 계정을 찾을 수 없습니다.' });
    }
    // 이메일 마스킹: sun1735@naver.com → s***35@naver.com
    const email = rows[0].email;
    const [local, domain] = email.split('@');
    const masked = local.length <= 3
      ? local[0] + '***'
      : local[0] + '***' + local.slice(-2);
    res.json({ masked_email: masked + '@' + domain });
  } catch (err) {
    res.status(500).json({ error: 'server_error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/forgot-password — 비밀번호 재설정 요청
// 이메일 입력 → 토큰 생성 → Discord 관리자 알림 (이메일 미설정 시)
// ─────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'missing_email' });

  try {
    const { rows } = await query(
      'SELECT id, nickname FROM users WHERE email = $1 AND is_active = TRUE',
      [email.toLowerCase()]
    );
    // 보안: 계정이 없어도 같은 응답 (이메일 존재 여부 노출 방지)
    if (rows.length === 0) {
      return res.json({ ok: true, message: '해당 이메일로 재설정 안내가 발송되었습니다.' });
    }

    const user = rows[0];
    const token = crypto.randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30분

    // 기존 미사용 토큰 무효화
    await query(
      'UPDATE password_resets SET used = TRUE WHERE user_id = $1 AND used = FALSE',
      [user.id]
    );
    // 새 토큰 저장
    await query(
      'INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expiresAt]
    );

    const resetUrl = `https://www.grovel.kr/reset-password.html?token=${token}`;

    // Discord 관리자 알림으로 전송 (이메일 대체)
    notifyError({
      title: '🔑 비밀번호 재설정 요청',
      message: `닉네임: ${user.nickname}\n이메일: ${email}\n\n재설정 링크 (30분 유효):\n${resetUrl}\n\n이 링크를 해당 회원에게 전달하세요.`,
    }).catch(() => {});

    console.log('[auth] password reset requested for:', email, '→', resetUrl);

    res.json({ ok: true, message: '재설정 안내가 발송되었습니다. 관리자가 확인 후 안내드립니다.' });
  } catch (err) {
    console.error('[auth/forgot-password]', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/reset-password — 비밀번호 재설정 실행
// 토큰 + 새 비밀번호
// ─────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  const { token, new_password } = req.body || {};
  if (!token || !new_password) return res.status(400).json({ error: 'missing_fields' });
  if (new_password.length < PWD_MIN) return res.status(400).json({ error: 'weak_password', message: `비밀번호는 ${PWD_MIN}자 이상` });

  try {
    const { rows } = await query(
      `SELECT pr.id, pr.user_id FROM password_resets pr
       WHERE pr.token = $1 AND pr.used = FALSE AND pr.expires_at > NOW()`,
      [token]
    );
    if (rows.length === 0) {
      return res.status(400).json({ error: 'invalid_token', message: '유효하지 않거나 만료된 링크입니다. 다시 요청해 주세요.' });
    }

    const hash = await bcrypt.hash(new_password, 12);
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [rows[0].user_id, hash]);
    await query('UPDATE password_resets SET used = TRUE WHERE id = $1', [rows[0].id]);

    res.json({ ok: true, message: '비밀번호가 변경되었습니다. 새 비밀번호로 로그인하세요.' });
  } catch (err) {
    console.error('[auth/reset-password]', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─────────────────────────────────────────────
// PUT /api/auth/profile — 프로필 수정
// ─────────────────────────────────────────────
router.put('/profile', requireAuth, async (req, res) => {
  const { nickname, bio, current_password, new_password } = req.body || {};

  try {
    const updates = [];
    const params = [req.user.id];

    // 닉네임 변경
    if (nickname && nickname !== req.user.nickname) {
      if (!NICK_RE.test(nickname)) {
        return res.status(400).json({ error: 'invalid_nickname', message: '닉네임은 한글/영문/숫자/_ 2-20자' });
      }
      if (isBlockedNickname(nickname)) {
        return res.status(400).json({ error: 'blocked_nickname', message: '마케톡/관리자 관련 닉네임은 사용할 수 없습니다.' });
      }
      const { rows: dup } = await query('SELECT id FROM users WHERE nickname = $1 AND id != $2', [nickname, req.user.id]);
      if (dup.length > 0) return res.status(409).json({ error: 'duplicate_nickname', message: '이미 사용 중인 닉네임입니다.' });
      params.push(nickname);
      updates.push(`nickname = $${params.length}`);
    }

    // 자기소개 변경
    if (bio !== undefined) {
      params.push(String(bio).slice(0, 200));
      updates.push(`bio = $${params.length}`);
    }

    // 비밀번호 변경
    if (new_password) {
      if (!current_password) return res.status(400).json({ error: 'missing_current_password', message: '현재 비밀번호를 입력하세요.' });
      if (new_password.length < PWD_MIN) return res.status(400).json({ error: 'weak_password', message: `새 비밀번호는 ${PWD_MIN}자 이상` });

      const { rows: userRows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
      const ok = await bcrypt.compare(current_password, userRows[0].password_hash);
      if (!ok) return res.status(401).json({ error: 'wrong_password', message: '현재 비밀번호가 틀립니다.' });

      const hash = await bcrypt.hash(new_password, 12);
      params.push(hash);
      updates.push(`password_hash = $${params.length}`);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'nothing_to_update' });

    await query(`UPDATE users SET ${updates.join(', ')} WHERE id = $1`, params);

    // 닉네임 변경 시 토큰 갱신
    if (nickname && nickname !== req.user.nickname) {
      const { rows } = await query('SELECT id, email, nickname, role FROM users WHERE id = $1', [req.user.id]);
      const token = signToken(rows[0]);
      setSessionCookie(res, token);
    }

    res.json({ ok: true, message: '프로필이 수정되었습니다.' });
  } catch (err) {
    console.error('[auth/profile]', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/auth/my-posts — 내가 쓴 글
// ─────────────────────────────────────────────
router.get('/my-posts', requireAuth, async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = 20;
  const offset = (page - 1) * limit;
  try {
    const { rows } = await query(`
      SELECT p.id, p.title, p.comment_count, p.view_count, p.like_count, p.published_at,
             b.name AS board_name, b.slug AS board_slug, b.badge_class
      FROM posts p JOIN boards b ON b.id = p.board_id
      WHERE p.user_id = $1
      ORDER BY p.published_at DESC
      LIMIT $2 OFFSET $3
    `, [req.user.id, limit, offset]);
    const { rows: cnt } = await query('SELECT COUNT(*)::int AS c FROM posts WHERE user_id = $1', [req.user.id]);
    res.json({ posts: rows, total: cnt[0].c, page, limit });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/auth/my-comments — 내가 쓴 댓글
// ─────────────────────────────────────────────
router.get('/my-comments', requireAuth, async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = 20;
  const offset = (page - 1) * limit;
  try {
    const { rows } = await query(`
      SELECT c.id, c.body, c.like_count, c.created_at,
             p.id AS post_id, p.title AS post_title
      FROM comments c JOIN posts p ON p.id = c.post_id
      WHERE c.user_id = $1
      ORDER BY c.created_at DESC
      LIMIT $2 OFFSET $3
    `, [req.user.id, limit, offset]);
    const { rows: cnt } = await query('SELECT COUNT(*)::int AS c FROM comments WHERE user_id = $1', [req.user.id]);
    res.json({ comments: rows, total: cnt[0].c, page, limit });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/auth/my-likes — 내가 좋아요한 글
// ─────────────────────────────────────────────
router.get('/my-likes', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT p.id, p.title, p.comment_count, p.view_count, p.like_count, p.published_at,
             b.name AS board_name, b.badge_class
      FROM likes l
      JOIN posts p ON p.id = l.target_id
      JOIN boards b ON b.id = p.board_id
      WHERE l.user_id = $1 AND l.target_type = 'post'
      ORDER BY l.created_at DESC
      LIMIT 50
    `, [req.user.id]);
    res.json({ posts: rows });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/auth/stats — 내 활동 통계
// ─────────────────────────────────────────────
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        (SELECT COUNT(*)::int FROM posts WHERE user_id = $1) AS post_count,
        (SELECT COUNT(*)::int FROM comments WHERE user_id = $1) AS comment_count,
        (SELECT COUNT(*)::int FROM likes WHERE user_id = $1) AS like_count
    `, [req.user.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

module.exports = router;
