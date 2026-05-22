/**
 * 인증 미들웨어 — JWT 쿠키 검증 + 역할 체크
 */
const jwt = require('jsonwebtoken');
const { query } = require('../db');

// JWT_SECRET은 프로덕션에서 미설정 시 폴백 금지 (세션 위조 방지)
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET 환경변수가 설정되지 않았습니다. 프로덕션에서는 반드시 설정해야 합니다.');
}
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-in-production';
const JWT_EXPIRES_IN = '30d';
const COOKIE_NAME = 'mt_session';

if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET 미설정 — 개발용 기본값 사용 중. (production에서는 throw됨)');
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, nickname: user.nickname, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 3600 * 1000,  // 30일
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/**
 * 모든 요청에 req.user를 채워주는 옵셔널 미들웨어.
 * 토큰이 없거나 잘못돼도 통과시키지만 req.user는 null.
 */
async function attachUser(req, _res, next) {
  req.user = null;
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // 매 요청 DB hit 피하려고 토큰 페이로드만 사용. role 변경은 재로그인 시 반영.
    req.user = {
      id: payload.id,
      email: payload.email,
      nickname: payload.nickname,
      role: payload.role,
    };
  } catch (_) {
    // 만료/위조 → null 유지
  }
  next();
}

// 정지 상태 캐시 — userId → { active: bool, exp: ms }. 60초 TTL.
const ACTIVE_CACHE_TTL = 60 * 1000;
const activeCache = new Map();
async function checkActive(userId) {
  const now = Date.now();
  const c = activeCache.get(userId);
  if (c && c.exp > now) return c.active;
  try {
    const { rows } = await query('SELECT is_active FROM users WHERE id = $1', [userId]);
    const active = rows.length > 0 ? rows[0].is_active : false;
    activeCache.set(userId, { active, exp: now + ACTIVE_CACHE_TTL });
    if (activeCache.size > 5000) {
      // GC: 만료 항목 정리
      for (const [k, v] of activeCache) {
        if (v.exp <= now) activeCache.delete(k);
        if (activeCache.size <= 4000) break;
      }
    }
    return active;
  } catch {
    return true; // DB 오류 시 통과 (가용성 우선)
  }
}

/** 로그인 필수 + 활성 계정 확인 */
async function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'auth_required' });
  const active = await checkActive(req.user.id);
  if (!active) {
    clearSessionCookie(res);
    return res.status(403).json({ error: 'account_suspended', message: '계정이 정지되었습니다. 운영자에게 문의해 주세요.' });
  }
  next();
}

/** 어드민 필수 */
async function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'auth_required' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin_required' });
  const active = await checkActive(req.user.id);
  if (!active) {
    clearSessionCookie(res);
    return res.status(403).json({ error: 'account_suspended' });
  }
  next();
}

module.exports = {
  signToken,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  requireAuth,
  requireAdmin,
  COOKIE_NAME,
};
