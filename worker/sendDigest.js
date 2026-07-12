/**
 * 주간 다이제스트 메일 — 지난 7일 인기글을 회원에게 발송.
 *
 * 대상: email_verified + email_notify + 최근 6일 내 다이제스트 미수신 회원.
 * 재실행해도 6일 가드 덕에 중복 발송되지 않음 (멱등).
 *
 * 사용:
 *   node worker/sendDigest.js             # 발송
 *   node worker/sendDigest.js --dry-run   # 대상·내용만 출력
 *
 * Railway cron 예시 (매주 월요일 오전 8시 KST = 일요일 23:00 UTC):
 *   0 23 * * 0  node worker/sendDigest.js
 */
require('../instrument');
require('dotenv').config();
const { pool, query } = require('../db');
const { sendEmail, renderEmail, makeUnsubUrl, isEmailEnabled, isDeliverable, BASE_URL } = require('./mailer');

const TOP_POSTS = 6;
const SEND_DELAY_MS = 600; // Resend 무료 티어 rate limit(2 req/s) 여유

const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--dry');

async function getTopPosts() {
  const { rows } = await query(`
    SELECT p.id, p.title, p.comment_count, p.like_count, p.view_count, b.name AS board_name
    FROM posts p
    JOIN boards b ON b.id = p.board_id
    WHERE p.published_at > NOW() - INTERVAL '7 days'
      AND b.slug != 'notice'
    ORDER BY (p.like_count * 3 + p.comment_count * 2) DESC, p.view_count DESC
    LIMIT $1
  `, [TOP_POSTS]);
  return rows;
}

async function getRecipients() {
  const { rows } = await query(`
    SELECT u.id, u.email, u.nickname
    FROM users u
    WHERE u.is_active = TRUE
      AND u.email_verified = TRUE
      AND u.email_notify = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM email_log el
        WHERE el.user_id = u.id AND el.kind = 'digest'
          AND el.sent_at > NOW() - INTERVAL '6 days'
      )
    ORDER BY u.id
  `);
  return rows.filter(u => isDeliverable(u.email));
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderDigestBody(posts) {
  const items = posts.map((p, i) => `
    <tr><td style="padding:10px 0;border-bottom:1px solid #f0f1f3;">
      <a href="${BASE_URL}/post.html?id=${p.id}" style="font-size:14px;font-weight:700;color:#111827;text-decoration:none;">
        ${i + 1}. ${escapeHtml(p.title)}</a><br>
      <span style="font-size:12px;color:#9ca3af;">${escapeHtml(p.board_name)} · 댓글 ${p.comment_count} · 좋아요 ${p.like_count}</span>
    </td></tr>`).join('');
  return `<p style="margin:0 0 8px;">이번 주 마케톡에서 가장 뜨거웠던 글이에요.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>`;
}

async function main() {
  console.log(`📮 주간 다이제스트 워커 시작${dryRun ? ' (DRY-RUN)' : ''}`);

  if (!dryRun && !isEmailEnabled()) {
    console.log('   RESEND_API_KEY 미설정 또는 EMAIL_ENABLED=false — 종료');
    await pool.end();
    return;
  }

  const posts = await getTopPosts();
  if (posts.length < 3) {
    console.log(`   지난 7일 글이 ${posts.length}개뿐 — 다이제스트 스킵 (최소 3개 필요)`);
    await pool.end();
    return;
  }

  const recipients = await getRecipients();
  console.log(`   인기글 ${posts.length}개, 수신자 ${recipients.length}명`);
  posts.forEach((p, i) => console.log(`   ${i + 1}. [${p.board_name}] ${p.title.slice(0, 50)}`));

  let sent = 0, failed = 0;
  for (const u of recipients) {
    if (dryRun) {
      console.log(`   🧪 would send → ${u.email} (${u.nickname})`);
      continue;
    }
    try {
      const result = await sendEmail({
        to: u.email,
        subject: `이번 주 마케터들이 가장 많이 본 글 TOP ${posts.length} 📈`,
        html: renderEmail({
          preheader: posts[0].title.slice(0, 80),
          title: `${u.nickname}님, 이번 주 마케톡 하이라이트예요`,
          bodyHtml: renderDigestBody(posts),
          ctaText: '마케톡 둘러보기',
          ctaUrl: BASE_URL,
          unsubscribeUrl: makeUnsubUrl(u.id),
        }),
      });
      if (result && !result.skipped) {
        await query(`INSERT INTO email_log (user_id, kind) VALUES ($1, 'digest')`, [u.id]);
        sent++;
      }
    } catch (err) {
      console.error(`   ❌ ${u.email}: ${err.message}`);
      failed++;
    }
    await new Promise(r => setTimeout(r, SEND_DELAY_MS));
  }

  console.log(`\n🎯 결과: 발송 ${sent}, 실패 ${failed}${dryRun ? ` (dry-run, 대상 ${recipients.length})` : ''}`);
  await pool.end();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('💥 워커 충돌:', err);
    pool.end().then(() => process.exit(1));
  });
}
