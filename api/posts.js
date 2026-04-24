const express = require('express');
const multer = require('multer');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { notifyNewPost, notifyNewComment } = require('../worker/discord');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('이미지 파일만 업로드 가능합니다'));
  },
});

// ─────────────────────────────────────────────
// GET /api/posts/images/:id — 이미지 서빙
// ─────────────────────────────────────────────
router.get('/images/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).end();
  try {
    const { rows } = await query(
      'SELECT image_data, image_mime FROM post_images WHERE id = $1',
      [id]
    );
    if (rows.length === 0) return res.status(404).end();
    res.set('Content-Type', rows[0].image_mime);
    res.set('Cache-Control', 'public, max-age=604800'); // 7일
    res.send(rows[0].image_data);
  } catch {
    res.status(500).end();
  }
});

// ─────────────────────────────────────────────
// GET /api/posts/hot — 실시간 인기글 Top N
// 최근 24h 내 게시글 중 (조회수 + 댓글수×30) 점수로 정렬
// ─────────────────────────────────────────────
router.get('/hot', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 5, 20);
  try {
    const { rows } = await query(`
      SELECT
        p.id, p.title, p.comment_count, p.view_count, p.published_at,
        b.slug AS board_slug, b.name AS board_name, b.badge_class
      FROM posts p
      JOIN boards b ON b.id = p.board_id
      WHERE p.published_at > NOW() - INTERVAL '24 hours'
        AND p.is_pinned = FALSE
      ORDER BY (p.view_count + p.comment_count * 30) DESC
      LIMIT $1
    `, [limit]);
    res.json({ posts: rows });
  } catch (err) {
    console.error('[api/posts/hot]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/posts/weekly — 주간 베스트 Top N
// ─────────────────────────────────────────────
router.get('/weekly', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 5, 10);
  try {
    const { rows } = await query(`
      SELECT p.id, p.title, p.comment_count, p.view_count, p.like_count, p.published_at,
             b.slug AS board_slug, b.name AS board_name
      FROM posts p JOIN boards b ON b.id = p.board_id
      WHERE p.published_at > NOW() - INTERVAL '7 days' AND p.is_pinned = FALSE
      ORDER BY (p.view_count + p.comment_count * 30 + p.like_count * 50) DESC
      LIMIT $1
    `, [limit]);
    res.json({ posts: rows });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/posts/recent-comments — 최근 댓글 (메인용)
// ─────────────────────────────────────────────
router.get('/recent-comments', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 5, 10);
  try {
    const { rows } = await query(`
      SELECT c.id, c.body, c.author_nickname, c.created_at,
             p.id AS post_id, p.title AS post_title
      FROM comments c JOIN posts p ON p.id = c.post_id
      ORDER BY c.created_at DESC
      LIMIT $1
    `, [limit]);
    res.json({ comments: rows });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/posts/news — 뉴스/동향 게시판 전체
// ─────────────────────────────────────────────
router.get('/news', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 5, 10);
  try {
    const { rows } = await query(`
      SELECT p.id, p.title, p.platform, p.published_at, p.view_count, p.comment_count,
             SUBSTRING(p.body, 1, 120) AS excerpt
      FROM posts p JOIN boards b ON b.id = p.board_id
      WHERE b.slug = 'news'
      ORDER BY p.published_at DESC
      LIMIT $1
    `, [limit]);
    res.json({ posts: rows });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/posts/briefings — 마케톡 공식 뉴스 브리핑만
// ─────────────────────────────────────────────
router.get('/briefings', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 5, 10);
  try {
    const { rows } = await query(`
      SELECT p.id, p.title, p.published_at, p.view_count
      FROM posts p
      WHERE p.author_nickname = '마케톡'
      ORDER BY p.published_at DESC
      LIMIT $1
    `, [limit]);
    res.json({ posts: rows });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/posts?board=ad&page=1&limit=20
// 게시글 목록. 공지(is_pinned)는 항상 상단.
// ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  const board = req.query.board;
  const platform = req.query.platform;
  const page  = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = (page - 1) * limit;

  try {
    const where = [];
    const params = [];

    if (board && board !== 'all') {
      params.push(board);
      where.push(`b.slug = $${params.length}`);
    }
    if (platform && platform !== 'all') {
      params.push(platform);
      where.push(`p.platform = $${params.length}`);
    }
    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    params.push(limit, offset);

    const sql = `
      SELECT
        p.id, p.title, p.author_nickname, p.persona_id, p.platform,
        p.comment_count, p.view_count, p.is_pinned, p.is_hot,
        p.published_at, p.metadata,
        b.slug AS board_slug, b.name AS board_name, b.badge_class
      FROM posts p
      JOIN boards b ON b.id = p.board_id
      ${whereClause}
      ORDER BY p.is_pinned DESC, p.published_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const { rows } = await query(sql, params);

    // 총 카운트 (페이지네이션용)
    const countParams = params.slice(0, params.length - 2);
    const { rows: countRows } = await query(`
      SELECT COUNT(*)::int AS total
      FROM posts p JOIN boards b ON b.id = p.board_id
      ${whereClause}
    `, countParams);

    res.json({
      posts: rows,
      page,
      limit,
      total: countRows[0].total,
      hasMore: offset + rows.length < countRows[0].total,
    });
  } catch (err) {
    console.error('[api/posts]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/posts/:id — 게시글 상세 + 댓글
// ─────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });

  try {
    const { rows: postRows } = await query(`
      SELECT
        p.*,
        b.slug AS board_slug, b.name AS board_name, b.badge_class
      FROM posts p
      JOIN boards b ON b.id = p.board_id
      WHERE p.id = $1
    `, [id]);

    if (postRows.length === 0) {
      return res.status(404).json({ error: 'not_found' });
    }

    const { rows: commentRows } = await query(`
      SELECT id, parent_id, persona_id, user_id, author_nickname, body, like_count, created_at
      FROM comments
      WHERE post_id = $1
      ORDER BY created_at ASC
    `, [id]);

    const { rows: imageRows } = await query(`
      SELECT id, file_name, file_size, sort_order
      FROM post_images
      WHERE post_id = $1
      ORDER BY sort_order
    `, [id]);

    res.json({
      post: postRows[0],
      comments: commentRows,
      images: imageRows.map(img => ({
        ...img,
        url: `/api/posts/images/${img.id}`,
      })),
    });
  } catch (err) {
    console.error('[api/posts/:id]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// POST /api/posts/:id/view — 조회수 +1
// 정밀한 사람/봇 구분 없이 단순 증가. 추후 IP·세션 기반으로 보강 가능.
// ─────────────────────────────────────────────
router.post('/:id/view', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  try {
    await query('UPDATE posts SET view_count = view_count + 1 WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// POST /api/posts — 유저가 글 작성 (인증 필수)
// body: { board_slug, title, body }
// ─────────────────────────────────────────────
router.post('/', requireAuth, upload.array('images', 5), async (req, res) => {
  const { board_slug, title, body } = req.body || {};
  let metadata = req.body.metadata;
  if (typeof metadata === 'string') { try { metadata = JSON.parse(metadata); } catch { metadata = null; } }
  if (!board_slug || !title || !body) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (title.length < 4 || title.length > 200) {
    return res.status(400).json({ error: 'invalid_title' });
  }
  if (body.length < 5 || body.length > 8000) {
    return res.status(400).json({ error: 'invalid_body' });
  }

  try {
    const { rows: boardRows } = await query('SELECT id FROM boards WHERE slug = $1', [board_slug]);
    if (boardRows.length === 0) return res.status(400).json({ error: 'invalid_board' });

    // 도배 방지 (60초 쿨다운)
    const { rows: recent } = await query(
      `SELECT id FROM posts WHERE user_id = $1 AND published_at > NOW() - INTERVAL '60 seconds' LIMIT 1`,
      [req.user.id]
    );
    if (recent.length > 0) {
      return res.status(429).json({ error: 'too_fast', message: '잠시 후 다시 시도해 주세요.' });
    }

    // 신규 계정 쓰로틀링 (관리자 제외, 봇·스팸 방어)
    if (req.user.role !== 'admin') {
      const { rows: userRows } = await query('SELECT created_at FROM users WHERE id = $1', [req.user.id]);
      if (userRows.length > 0) {
        const ageMs = Date.now() - new Date(userRows[0].created_at).getTime();
        const ONE_HOUR = 60 * 60 * 1000;

        // 가입 후 1시간 이내: 글쓰기 차단 (댓글만 가능)
        if (ageMs < ONE_HOUR) {
          return res.status(403).json({
            error: 'account_too_new',
            message: '가입 후 1시간이 지나면 글쓰기가 가능합니다. 그동안 댓글로 활동해 주세요.',
          });
        }
        // 가입 후 24시간 이내: 시간당 1건 제한
        if (ageMs < 24 * ONE_HOUR) {
          const { rows: hourly } = await query(
            `SELECT COUNT(*)::int AS c FROM posts WHERE user_id = $1 AND published_at > NOW() - INTERVAL '1 hour'`,
            [req.user.id]
          );
          if (hourly[0].c >= 1) {
            return res.status(429).json({
              error: 'new_account_hourly_limit',
              message: '신규 계정은 시간당 1건만 글쓰기가 가능합니다. 1시간 후 다시 시도해 주세요.',
            });
          }
        }
      }
    }

    // 구인/협업 보드면 metadata 검증
    let cleanedMeta = null;
    if (board_slug === 'job' && metadata && typeof metadata === 'object') {
      cleanedMeta = {
        budget:    String(metadata.budget || '').slice(0, 64),
        duration:  String(metadata.duration || '').slice(0, 64),
        category:  String(metadata.category || '').slice(0, 32),
        deadline:  String(metadata.deadline || '').slice(0, 32),
        location:  String(metadata.location || '').slice(0, 64),
        contact:   String(metadata.contact || '').slice(0, 128),
      };
    }

    const { rows } = await query(
      `INSERT INTO posts
        (board_id, user_id, author_nickname, title, body, view_count, is_ai, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,FALSE,$7)
       RETURNING id, published_at`,
      [boardRows[0].id, req.user.id, req.user.nickname, title.trim(), body.trim(), 0, cleanedMeta]
    );
    const postId = rows[0].id;

    // 이미지 저장 (있으면)
    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const f = req.files[i];
        await query(
          `INSERT INTO post_images (post_id, image_data, image_mime, file_name, file_size, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [postId, f.buffer, f.mimetype, f.originalname, f.size, i]
        );
      }
    }

    // 디스코드 알림
    notifyNewPost({
      id: postId, title: title.trim(),
      author: req.user.nickname, board: board_slug,
      excerpt: body.trim().slice(0, 150),
    }).catch(() => {});

    res.status(201).json({ post: rows[0] });
  } catch (err) {
    console.error('[posts/create]', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/posts/:id/comments — 유저가 댓글 작성 (인증 필수)
// body: { body, parent_id? }
// ─────────────────────────────────────────────
router.post('/:id/comments', requireAuth, async (req, res) => {
  const postId = parseInt(req.params.id);
  if (!postId) return res.status(400).json({ error: 'invalid_id' });

  const { body, parent_id } = req.body || {};
  if (!body || body.trim().length < 2 || body.length > 1000) {
    return res.status(400).json({ error: 'invalid_body' });
  }

  try {
    // 글 존재 확인
    const { rows: postRows } = await query('SELECT id FROM posts WHERE id = $1', [postId]);
    if (postRows.length === 0) return res.status(404).json({ error: 'post_not_found' });

    // 도배 방지: 같은 유저가 최근 15초 안에 댓글 작성한 적 있으면 거부
    const { rows: recent } = await query(
      `SELECT id FROM comments
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '15 seconds'
       LIMIT 1`,
      [req.user.id]
    );
    if (recent.length > 0) {
      return res.status(429).json({ error: 'too_fast' });
    }

    const { rows } = await query(
      `INSERT INTO comments (post_id, parent_id, user_id, author_nickname, body, is_ai)
       VALUES ($1,$2,$3,$4,$5,FALSE)
       RETURNING id, created_at`,
      [postId, parent_id || null, req.user.id, req.user.nickname, body.trim()]
    );

    await query('UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1', [postId]);

    // 원글 제목 가져와서 디스코드 알림
    const { rows: postInfo } = await query('SELECT title FROM posts WHERE id = $1', [postId]);
    notifyNewComment({
      postId, postTitle: postInfo[0]?.title || '',
      author: req.user.nickname, body: body.trim().slice(0, 150),
    }).catch(() => {});

    res.status(201).json({ comment: rows[0] });
  } catch (err) {
    console.error('[comments/create]', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─────────────────────────────────────────────
// PUT /api/posts/:id — 글 수정 (작성자 본인만)
// ─────────────────────────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const { title, body } = req.body || {};

  try {
    // 본인 글인지 확인 (admin이면 모두 수정 가능)
    const { rows: postRows } = await query('SELECT user_id FROM posts WHERE id = $1', [id]);
    if (postRows.length === 0) return res.status(404).json({ error: 'not_found' });
    if (postRows[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'not_author' });
    }

    const updates = [];
    const params = [id];
    if (title && title.trim().length >= 4) {
      params.push(title.trim());
      updates.push(`title = $${params.length}`);
    }
    if (body && body.trim().length >= 5) {
      params.push(body.trim());
      updates.push(`body = $${params.length}`);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'nothing_to_update' });

    await query(`UPDATE posts SET ${updates.join(', ')} WHERE id = $1`, params);
    res.json({ ok: true });
  } catch (err) {
    console.error('[posts/update]', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/posts/:id — 글 삭제 (작성자 본인 또는 admin)
// ─────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });

  try {
    const { rows } = await query('SELECT user_id FROM posts WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
    if (rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'not_author' });
    }

    await query('DELETE FROM posts WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'server_error' });
  }
});

// ─────────────────────────────────────────────
// PUT /api/posts/:postId/comments/:commentId — 댓글 수정
// ─────────────────────────────────────────────
router.put('/:postId/comments/:commentId', requireAuth, async (req, res) => {
  const commentId = parseInt(req.params.commentId);
  if (!commentId) return res.status(400).json({ error: 'invalid_id' });
  const { body } = req.body || {};
  if (!body || body.trim().length < 2) return res.status(400).json({ error: 'invalid_body' });

  try {
    const { rows } = await query('SELECT user_id FROM comments WHERE id = $1', [commentId]);
    if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
    if (rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'not_author' });
    }

    await query('UPDATE comments SET body = $2 WHERE id = $1', [commentId, body.trim()]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'server_error' });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/posts/:postId/comments/:commentId — 댓글 삭제
// ─────────────────────────────────────────────
router.delete('/:postId/comments/:commentId', requireAuth, async (req, res) => {
  const postId = parseInt(req.params.postId);
  const commentId = parseInt(req.params.commentId);
  if (!commentId) return res.status(400).json({ error: 'invalid_id' });

  try {
    const { rows } = await query('SELECT user_id FROM comments WHERE id = $1', [commentId]);
    if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
    if (rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'not_author' });
    }

    await query('DELETE FROM comments WHERE id = $1', [commentId]);
    await query('UPDATE posts SET comment_count = GREATEST(0, comment_count - 1) WHERE id = $1', [postId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'server_error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/reports — 신고 (인증 필수)
// body: { target_type: 'post'|'comment', target_id, reason, detail }
// ─────────────────────────────────────────────
router.post('/report', requireAuth, async (req, res) => {
  const { target_type, target_id, reason, detail } = req.body || {};
  if (!target_type || !target_id || !reason) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (!['post', 'comment'].includes(target_type)) {
    return res.status(400).json({ error: 'invalid_target_type' });
  }
  if (!['spam', 'abuse', 'inappropriate', 'other'].includes(reason)) {
    return res.status(400).json({ error: 'invalid_reason' });
  }
  try {
    // 중복 신고 방지
    const { rows: dup } = await query(
      `SELECT id FROM reports WHERE reporter_id=$1 AND target_type=$2 AND target_id=$3 LIMIT 1`,
      [req.user.id, target_type, parseInt(target_id)]
    );
    if (dup.length > 0) return res.json({ ok: true, message: '이미 신고하셨습니다.' });

    await query(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason, detail)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.user.id, target_type, parseInt(target_id), reason, (detail || '').slice(0, 500)]
    );

    // 디스코드 관리자 알림
    const { notifyError } = require('../worker/discord');
    notifyError({
      title: '🚨 신고 접수',
      message: `${target_type} #${target_id}\n사유: ${reason}\n${detail || ''}`,
    }).catch(() => {});

    res.json({ ok: true, message: '신고가 접수되었습니다. 관리자가 검토합니다.' });
  } catch (err) {
    console.error('[report]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// POST /api/posts/:id/like — 좋아요 토글 (인증 필수)
// 이미 좋아요 했으면 취소, 안 했으면 추가
// ─────────────────────────────────────────────
router.post('/:id/like', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  try {
    // 이미 좋아요 했는지 확인
    const { rows: existing } = await query(
      `SELECT id FROM likes WHERE user_id=$1 AND target_type='post' AND target_id=$2`,
      [req.user.id, id]
    );
    if (existing.length > 0) {
      // 좋아요 취소
      await query(`DELETE FROM likes WHERE id=$1`, [existing[0].id]);
      await query(`UPDATE posts SET like_count = GREATEST(0, like_count - 1) WHERE id=$1`, [id]);
      return res.json({ liked: false });
    }
    // 좋아요 추가
    await query(
      `INSERT INTO likes (user_id, target_type, target_id) VALUES ($1,'post',$2)`,
      [req.user.id, id]
    );
    await query(`UPDATE posts SET like_count = like_count + 1 WHERE id=$1`, [id]);
    res.json({ liked: true });
  } catch (err) {
    if (err.code === '23505') return res.json({ liked: true }); // duplicate
    console.error('[like/post]', err);
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// POST /api/posts/:postId/comments/:commentId/like — 댓글 좋아요 토글
// ─────────────────────────────────────────────
router.post('/:postId/comments/:commentId/like', requireAuth, async (req, res) => {
  const commentId = parseInt(req.params.commentId);
  if (!commentId) return res.status(400).json({ error: 'invalid_id' });
  try {
    const { rows: existing } = await query(
      `SELECT id FROM likes WHERE user_id=$1 AND target_type='comment' AND target_id=$2`,
      [req.user.id, commentId]
    );
    if (existing.length > 0) {
      await query(`DELETE FROM likes WHERE id=$1`, [existing[0].id]);
      await query(`UPDATE comments SET like_count = GREATEST(0, like_count - 1) WHERE id=$1`, [commentId]);
      return res.json({ liked: false });
    }
    await query(
      `INSERT INTO likes (user_id, target_type, target_id) VALUES ($1,'comment',$2)`,
      [req.user.id, commentId]
    );
    await query(`UPDATE comments SET like_count = like_count + 1 WHERE id=$1`, [commentId]);
    res.json({ liked: true });
  } catch (err) {
    if (err.code === '23505') return res.json({ liked: true });
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// GET /api/posts/:id/likes — 내가 이 글/댓글에 좋아요 했는지 확인
// ─────────────────────────────────────────────
router.get('/:id/likes', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!req.user) return res.json({ post_liked: false, comment_likes: [] });
  try {
    // 글 좋아요
    const { rows: pl } = await query(
      `SELECT id FROM likes WHERE user_id=$1 AND target_type='post' AND target_id=$2`,
      [req.user.id, id]
    );
    // 댓글 좋아요
    const { rows: cl } = await query(
      `SELECT target_id FROM likes WHERE user_id=$1 AND target_type='comment'
       AND target_id IN (SELECT id FROM comments WHERE post_id=$2)`,
      [req.user.id, id]
    );
    res.json({
      post_liked: pl.length > 0,
      comment_likes: cl.map(r => parseInt(r.target_id)),
    });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

module.exports = router;
