/**
 * Sentry 초기화 — 다른 모듈이 require 되기 전에 가장 먼저 로드.
 * SENTRY_DSN env가 없으면 자동 no-op (dev/local 환경 기본).
 *
 * 사용: server.js / worker/*.js 맨 위에서
 *   const sentryInit = require('./instrument');
 */
require('dotenv').config();

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  const Sentry = require('@sentry/node');
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'production',
    release: process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
    // HTTP 요청 중 10%만 성능 트레이스 (무료 quota 보호)
    tracesSampleRate: 0.1,
    // 쿠키/바디 같은 PII는 이벤트에 포함하지 않음
    sendDefaultPii: false,
  });
  console.log('[sentry] initialized');
  module.exports = { enabled: true, Sentry };
} else {
  module.exports = { enabled: false };
}
