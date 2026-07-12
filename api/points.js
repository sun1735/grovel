/**
 * /api/points/* — 출석·포인트·레벨
 *
 * 적립 규칙 (일일 상한으로 어뷰징 방지):
 *   출석            +5  (연속 3일+ 추가 +3, 7일+ 추가 +10) · 하루 1회
 *   글 작성         +10 · 하루 3회까지
 *   첫 글 보너스    +30 · 1회
 *   댓글 작성       +3  · 하루 10회까지
 *   받은 좋아요     +2  · 같은 사람이 같은 글/댓글에 다시 눌러도 재적립 없음 · 하루 20회까지
 *
 * 날짜 경계는 KST 기준.
 */
const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── 레벨 테이블 ──
const LEVELS = [
  { lv: 1,  min: 0,    title: '마케팅 인턴' },
  { lv: 2,  min: 50,   title: '주니어 마케터' },
  { lv: 3,  min: 150,  title: '시니어 마케터' },
  { lv: 4,  min: 300,  title: '마케팅 리드' },
  { lv: 5,  min: 600,  title: '팀장' },
  { lv: 6,  min: 1000, title: '본부장' },
  { lv: 7,  min: 1500, title: '이사' },
  { lv: 8,  min: 2200, title: '부사장' },
  { lv: 9,  min: 3000, title: 'CMO' },
  { lv: 10, min: 4000, title: '마케팅 레전드' },
];

function levelFor(points) {
  let cur = LEVELS[0];
  for (const l of LEVELS) if (points >= l.min) cur = l;
  const next = LEVELS.find(l => l.min > points) || null;
  return {
    level: cur.lv,
    title: cur.title,
    next_level_at: next ? next.min : null,
    progress: next ? Math.round(((points - cur.min) / (next.min - cur.min)) * 100) : 100,
  };
}

const DAILY_CAPS = { post: 3, comment: 10, like_received: 20 };

// KST 오늘 조건 (컬럼명 주입 없음 — 고정 문자열)
const KST_TODAY = `(created_at AT TIME ZONE 'Asia/Seoul')::date = (NOW() AT TIME ZONE 'Asia/Seoul')::date`;

// ─────────────────────────────────────────────
// 적립 헬퍼 (다른 API에서 호출) — 실패해도 원 동작에 영향 없게 호출부에서 catch
// likerId: 'like_received' 전용 — (대상, 누른 사람) 조합당 1회만 적립
// ─────────────────────────────────────────────
async function awardPoints(userId, kind, points, refId = null, likerId = null) {
  if (!userId || !points) return null;

  // 일일 상한
  const cap = DAILY_CAPS[kind];
  if (cap) {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS c FROM point_log
       WHERE user_id = $1 AND kind = $2 AND ${KST_TODAY}`,
      [userId, kind]
    );
    if (rows[0].c >= cap) return null;
  }

  // 좋아요: 같은 (대상, 누른 사람) 재적립 방지
  if (kind === 'like_received' && refId && likerId) {
    const { rows } = await query(
      `SELECT 1 FROM point_log
       WHERE kind = 'like_received' AND ref_id = $1 AND liker_id = $2 LIMIT 1`,
      [refId, likerId]
    );
    if (rows.length > 0) return null;
  }

  await query(
    `INSERT INTO point_log (user_id, kind, points, ref_id, liker_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [userId, kind, points, refId, likerId]
  );
  const { rows } = await query(
    `UPDATE users SET points = COALESCE(points,0) + $2 WHERE id = $1 RETURNING points`,
    [userId, points]
  );
  return rows[0]?.points ?? null;
}

// ─────────────────────────────────────────────
// POST /api/points/checkin — 출석 체크 (하루 1회, 멱등)
// ─────────────────────────────────────────────
router.post('/checkin', requireAuth, async (req, res) => {
  try {
    const { rows: today } = await query(
      `SELECT 1 FROM point_log WHERE user_id = $1 AND kind = 'attendance' AND ${KST_TODAY} LIMIT 1`,
      [req.user.id]
    );

    // 연속 출석 계산: 최근 출석 날짜들(KST)로 오늘/어제부터 거꾸로 카운트
    const { rows: days } = await query(
      `SELECT DISTINCT (created_at AT TIME ZONE 'Asia/Seoul')::date AS d
       FROM point_log WHERE user_id = $1 AND kind = 'attendance'
       ORDER BY d DESC LIMIT 60`,
      [req.user.id]
    );
    const dateSet = new Set(days.map(r => r.d.toISOString().slice(0, 10)));
    const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
    let streak = 0;
    for (let i = 0; ; i++) {
      const d = new Date(kstNow.getTime() - i * 86400 * 1000).toISOString().slice(0, 10);
      if (dateSet.has(d)) streak++;
      else if (i === 0) continue;  // 오늘은 아직 체크 전일 수 있음
      else break;
    }

    if (today.length > 0) {
      const { rows: u } = await query('SELECT COALESCE(points,0) AS points FROM users WHERE id = $1', [req.user.id]);
      return res.json({ checked_now: false, streak, total_points: u[0].points, ...levelFor(u[0].points) });
    }

    streak += 1; // 오늘 포함
    const bonus = streak >= 7 ? 10 : streak >= 3 ? 3 : 0;
    const earned = 5 + bonus;
    const total = await awardPoints(req.user.id, 'attendance', earned);

    res.json({ checked_now: true, earned, streak, total_points: total, ...levelFor(total) });
  } catch (err) {
    console.error('[points/checkin]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/points/me — 내 포인트·레벨·오늘 출석 여부
// ─────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows: u } = await query('SELECT COALESCE(points,0) AS points FROM users WHERE id = $1', [req.user.id]);
    const { rows: today } = await query(
      `SELECT 1 FROM point_log WHERE user_id = $1 AND kind = 'attendance' AND ${KST_TODAY} LIMIT 1`,
      [req.user.id]
    );
    res.json({ total_points: u[0].points, checked_today: today.length > 0, ...levelFor(u[0].points) });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/points/ranking — 이번 주 활동 랭킹 TOP 5 (월요일 KST 기준)
// ─────────────────────────────────────────────
router.get('/ranking', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT u.nickname, SUM(pl.points)::int AS weekly_points, COALESCE(u.points,0) AS total_points
      FROM point_log pl
      JOIN users u ON u.id = pl.user_id
      WHERE pl.created_at >= date_trunc('week', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'
        AND u.is_active = TRUE
      GROUP BY u.id
      ORDER BY weekly_points DESC, total_points DESC
      LIMIT 5
    `);
    res.json({ ranking: rows.map(r => ({ ...r, ...levelFor(r.total_points) })) });
  } catch (err) {
    console.error('[points/ranking]', err);
    res.status(500).json({ error: 'failed' });
  }
});

module.exports = { router, awardPoints, levelFor };
