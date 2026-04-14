/**
 * /api/auth/* — 회원가입·로그인·로그아웃·내 정보
 *
 * - 첫 번째 가입자는 자동으로 admin 역할
 * - 비밀번호: bcryptjs (12 rounds)
 * - 세션: JWT httpOnly cookie 30일
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const {
  signToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
} = require('../middleware/auth');
const { notifyNewUser } = require('../worker/discord');

const router = express.Router();

const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NICK_RE     = /^[가-힣a-zA-Z0-9_]{2,20}$/;
const PWD_MIN     = 8;

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

module.exports = router;
