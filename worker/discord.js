/**
 * 디스코드 웹훅 알림 모듈.
 *
 * 채널 2개:
 *   DISCORD_WEBHOOK_POSTS → #새글알림 (공개, 유저도 봄)
 *   DISCORD_WEBHOOK_ADMIN → #관리자알림 (비공개, 관리자만)
 *
 * 속도 제한: 채널당 30 메시지/60초. 큐잉은 하지 않고, 실패 시 무시.
 */

const WEBHOOK_POSTS = process.env.DISCORD_WEBHOOK_POSTS;
const WEBHOOK_ADMIN = process.env.DISCORD_WEBHOOK_ADMIN;

const BRAND_COLOR = 0xff3e5f;  // 마케톡 브랜드 핑크

async function send(webhookUrl, payload) {
  if (!webhookUrl) return;
  try {
    const r = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      console.warn('[discord] webhook failed:', r.status, await r.text().catch(() => ''));
    }
  } catch (err) {
    console.warn('[discord] webhook error:', err.message);
  }
}

// ─────────────────────────────────────────────
// 새 게시글 알림 → #새글알림
// ─────────────────────────────────────────────
async function notifyNewPost({ id, title, author, board, excerpt, url }) {
  await send(WEBHOOK_POSTS, {
    username: '마케톡',
    embeds: [{
      title: `📝 ${title}`,
      url: url || `https://www.grovel.kr/post.html?id=${id}`,
      description: (excerpt || '').slice(0, 200),
      color: BRAND_COLOR,
      fields: [
        { name: '게시판', value: board || '-', inline: true },
        { name: '작성자', value: author || '-', inline: true },
      ],
      footer: { text: '마케톡 · 새 글 알림' },
      timestamp: new Date().toISOString(),
    }],
  });
}

// ─────────────────────────────────────────────
// 새 댓글 알림 → #새글알림
// ─────────────────────────────────────────────
async function notifyNewComment({ postId, postTitle, author, body }) {
  await send(WEBHOOK_POSTS, {
    username: '마케톡',
    embeds: [{
      title: `💬 "${(postTitle || '').slice(0, 40)}" 에 새 댓글`,
      url: `https://www.grovel.kr/post.html?id=${postId}`,
      description: (body || '').slice(0, 200),
      color: 0x3b82f6,
      fields: [
        { name: '작성자', value: author || '-', inline: true },
      ],
      footer: { text: '마케톡 · 댓글 알림' },
      timestamp: new Date().toISOString(),
    }],
  });
}

// ─────────────────────────────────────────────
// 새 회원 가입 → #관리자알림
// ─────────────────────────────────────────────
async function notifyNewUser({ nickname, email, role }) {
  await send(WEBHOOK_ADMIN, {
    username: '마케톡 관리',
    embeds: [{
      title: `🎉 새 회원 가입`,
      color: 0x22c55e,
      fields: [
        { name: '닉네임', value: nickname || '-', inline: true },
        { name: '역할', value: role || 'user', inline: true },
      ],
      footer: { text: '마케톡 · 관리자 알림' },
      timestamp: new Date().toISOString(),
    }],
  });
}

// ─────────────────────────────────────────────
// 시스템 에러 → #관리자알림
// ─────────────────────────────────────────────
async function notifyError({ title, message }) {
  await send(WEBHOOK_ADMIN, {
    username: '마케톡 관리',
    embeds: [{
      title: `⚠️ ${title || '시스템 알림'}`,
      description: (message || '').slice(0, 500),
      color: 0xef4444,
      footer: { text: '마케톡 · 시스템 알림' },
      timestamp: new Date().toISOString(),
    }],
  });
}

// ─────────────────────────────────────────────
// 일일 통계 → #관리자알림
// ─────────────────────────────────────────────
async function notifyDailyStats({ posts, comments, users, engineRate }) {
  await send(WEBHOOK_ADMIN, {
    username: '마케톡 관리',
    embeds: [{
      title: `📊 일일 리포트`,
      color: 0x8b5cf6,
      fields: [
        { name: '오늘 글', value: String(posts), inline: true },
        { name: '오늘 댓글', value: String(comments), inline: true },
        { name: '총 회원', value: String(users), inline: true },
        { name: '엔진 신뢰도', value: engineRate + '%', inline: true },
      ],
      footer: { text: '마케톡 · 일일 리포트' },
      timestamp: new Date().toISOString(),
    }],
  });
}

module.exports = {
  notifyNewPost,
  notifyNewComment,
  notifyNewUser,
  notifyError,
  notifyDailyStats,
};
