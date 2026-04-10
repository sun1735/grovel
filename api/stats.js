const express = require('express');
const { query } = require('../db');

const router = express.Router();

// GET /api/stats — 사이드바용 커뮤니티 통계
router.get('/', async (_req, res) => {
  try {
    const { rows } = await query('SELECT * FROM stats_view');
    const stats = rows[0];

    // 가짜 멤버수와 접속자수는 계산식으로 자연스럽게 (실제 회원 시스템 붙기 전까지)
    // 현재 시간 기반으로 조금씩 변동하게 → 매번 같은 숫자 X
    const now = Date.now();
    const seed = Math.sin(now / 1000 / 60) * 0.5 + 0.5; // 0~1, 1분 주기 변동
    const baseMembers = 38000 + Math.floor(seed * 500);
    const baseOnline  = 1100 + Math.floor(Math.random() * 350);

    res.json({
      total_members: baseMembers + (stats.total_posts || 0) * 3,
      total_posts: stats.total_posts || 0,
      total_comments: stats.total_comments || 0,
      posts_today: stats.posts_today || 0,
      comments_today: stats.comments_today || 0,
      online_now: baseOnline,
    });
  } catch (err) {
    console.error('[api/stats]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// GET /api/stats/engine — 엔진 신뢰도 (관리자용)
router.get('/engine', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        COUNT(*)::int                                      AS total,
        SUM(CASE WHEN success THEN 1 ELSE 0 END)::int      AS successful,
        ROUND(
          100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0),
          2
        )                                                  AS success_rate,
        AVG(duration_ms)::int                              AS avg_duration_ms,
        SUM(input_tokens)::int                             AS total_input_tokens,
        SUM(output_tokens)::int                            AS total_output_tokens
      FROM engine_log
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `);
    res.json({ engine_24h: rows[0] });
  } catch (err) {
    console.error('[api/stats/engine]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// GET /api/stats/activity — 최근 24시간 시간대별 활동 (cron 동작 검증용)
router.get('/activity', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        DATE_TRUNC('hour', published_at) AS hour,
        COUNT(*)::int AS posts
      FROM posts
      WHERE published_at > NOW() - INTERVAL '24 hours'
      GROUP BY 1 ORDER BY 1
    `);
    const { rows: cmt } = await query(`
      SELECT
        DATE_TRUNC('hour', created_at) AS hour,
        COUNT(*)::int AS comments
      FROM comments
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY 1 ORDER BY 1
    `);
    res.json({ posts_by_hour: rows, comments_by_hour: cmt });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

// GET /api/stats/topics — 토픽 시드 풀 상태
router.get('/topics', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        board_slug,
        COUNT(*)::int AS total,
        SUM(CASE WHEN used_count = 0 THEN 1 ELSE 0 END)::int AS unused,
        AVG(used_count)::numeric(10,2) AS avg_used,
        MAX(used_count)::int AS max_used
      FROM topic_seeds
      GROUP BY board_slug
      ORDER BY board_slug
    `);
    res.json({ boards: rows });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

module.exports = router;
