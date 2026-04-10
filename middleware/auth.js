/**
 * 인증 미들웨어 — JWT 쿠키 검증 + 역할 체크
 */
const jwt = require('jsonwebtoken');
const { query } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-in-production';
const JWT_EXPIRES_IN = '30d';
const COOKIE_NAME = 'mt_session';

if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET 환경변수가 설정되지 않아 기본값을 사용합니다. 운영 환경에선 반드시 설정하세요.');
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

/** 로그인 필수 */
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'auth_required' });
  next();
}

/** 어드민 필수 */
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'auth_required' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin_required' });
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
