/**
 * 이메일 발송 — Resend API (https://resend.com)
 *
 * 환경변수:
 *   RESEND_API_KEY   — 없으면 발송 스킵 (로그만 남김, 에러 아님)
 *   EMAIL_FROM       — 발신자. 기본 '마케톡 <noreply@grovel.kr>'
 *   EMAIL_ENABLED    — 'false'로 두면 킬 스위치 (기본 활성)
 *
 * 사용:
 *   const { sendEmail, renderEmail, makeUnsubToken } = require('./mailer');
 *   await sendEmail({ to, subject, html });   // { id } | { skipped: true }
 */
const crypto = require('crypto');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || '마케톡 <noreply@grovel.kr>';
const BASE_URL = 'https://www.grovel.kr';

function isEmailEnabled() {
  return !!RESEND_API_KEY && process.env.EMAIL_ENABLED !== 'false';
}

// @kakao.local 등 실제 수신 불가능한 플레이스홀더 주소
function isDeliverable(email) {
  return !!email && !/@kakao\.local$/i.test(email);
}

async function sendEmail({ to, subject, html }) {
  if (!isDeliverable(to)) return { skipped: true, reason: 'undeliverable' };
  if (!isEmailEnabled()) {
    console.log(`[mailer] skip (disabled): "${subject}" → ${to}`);
    return { skipped: true, reason: 'disabled' };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  console.log(`[mailer] sent "${subject}" → ${to} (id=${data.id})`);
  return data;
}

// ─────────────────────────────────────────────
// 공통 이메일 템플릿 (테이블 레이아웃 — 메일 클라이언트 호환)
// ─────────────────────────────────────────────
function renderEmail({ preheader = '', title, bodyHtml, ctaText, ctaUrl, unsubscribeUrl }) {
  const cta = ctaText && ctaUrl ? `
    <tr><td align="center" style="padding:8px 0 24px;">
      <a href="${ctaUrl}" style="display:inline-block;background:#ff3e5f;color:#ffffff;
         font-size:15px;font-weight:700;text-decoration:none;padding:12px 32px;border-radius:8px;">
        ${ctaText}</a>
    </td></tr>` : '';
  const unsub = unsubscribeUrl ? `
    <a href="${unsubscribeUrl}" style="color:#9ca3af;text-decoration:underline;">이메일 수신 거부</a>` : '';
  return `<!doctype html><html lang="ko"><body style="margin:0;padding:0;background:#f4f5f7;">
  <span style="display:none;max-height:0;overflow:hidden;">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;
                    font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
        <tr><td style="background:#ff3e5f;padding:18px 28px;">
          <a href="${BASE_URL}" style="color:#ffffff;font-size:18px;font-weight:800;text-decoration:none;">마케톡</a>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 16px;font-size:19px;color:#111827;">${title}</h1>
          <div style="font-size:14px;line-height:1.7;color:#374151;">${bodyHtml}</div>
        </td></tr>
        ${cta}
        <tr><td style="padding:16px 28px 24px;border-top:1px solid #f0f1f3;">
          <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">
            마케터들의 익명 커뮤니티 · <a href="${BASE_URL}" style="color:#9ca3af;">www.grovel.kr</a><br>
            ${unsub}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

// ─────────────────────────────────────────────
// 수신 거부 토큰 — HMAC(JWT_SECRET) 기반, DB 조회 불필요
// ─────────────────────────────────────────────
const UNSUB_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-in-production';

function makeUnsubToken(userId) {
  return crypto.createHmac('sha256', UNSUB_SECRET).update(`unsub:${userId}`).digest('hex').slice(0, 32);
}

function verifyUnsubToken(userId, sig) {
  if (!userId || !sig) return false;
  const expected = makeUnsubToken(userId);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(sig)));
  } catch {
    return false;
  }
}

function makeUnsubUrl(userId) {
  return `${BASE_URL}/api/auth/email-unsubscribe?uid=${userId}&sig=${makeUnsubToken(userId)}`;
}

module.exports = {
  sendEmail,
  renderEmail,
  isEmailEnabled,
  isDeliverable,
  makeUnsubToken,
  verifyUnsubToken,
  makeUnsubUrl,
  BASE_URL,
};
