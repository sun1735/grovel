-- ============================================================
-- 마케톡 — Postgres 스키마 v1
-- ============================================================
-- KPI 추적이 가능하도록 설계:
--   * 식별률    → posts.is_ai 필드 + engine_log
--   * 신뢰도    → engine_log (성공률, 토큰, 에러)
--   * 잔존율    → memory_threads (페르소나-유저 컨텍스트 메모리)
-- ============================================================

-- ── boards: 게시판 카테고리 ─────────────────────
CREATE TABLE IF NOT EXISTS boards (
  id          SERIAL PRIMARY KEY,
  slug        VARCHAR(32) UNIQUE NOT NULL,
  name        VARCHAR(64) NOT NULL,
  description TEXT,
  badge_class VARCHAR(32),
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── personas: AI 페르소나 등록부 (ai/personas.js와 미러) ──
CREATE TABLE IF NOT EXISTS personas (
  id              VARCHAR(32) PRIMARY KEY,
  codename        CHAR(1) NOT NULL,
  archetype       VARCHAR(64) NOT NULL,
  reference_name  VARCHAR(32),
  bio             TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── posts: 게시글 ──────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id              BIGSERIAL PRIMARY KEY,
  board_id        INTEGER NOT NULL REFERENCES boards(id),
  persona_id      VARCHAR(32) REFERENCES personas(id),  -- NULL = 실제 유저
  author_nickname VARCHAR(64) NOT NULL,
  title           VARCHAR(255) NOT NULL,
  body            TEXT NOT NULL,
  view_count      INTEGER DEFAULT 0,
  comment_count   INTEGER DEFAULT 0,
  like_count      INTEGER DEFAULT 0,
  is_pinned       BOOLEAN DEFAULT FALSE,
  is_hot          BOOLEAN DEFAULT FALSE,
  is_ai           BOOLEAN DEFAULT FALSE,              -- 식별률 측정용
  published_at    TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_posts_board       ON posts(board_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_published   ON posts(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_hot         ON posts(is_hot, published_at DESC) WHERE is_hot = TRUE;
CREATE INDEX IF NOT EXISTS idx_posts_persona     ON posts(persona_id, published_at DESC);

-- 광고 보드 서브탭용 platform 컬럼 (naver, kakao, meta, google, youtube, tiktok, ...)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS platform VARCHAR(32);
CREATE INDEX IF NOT EXISTS idx_posts_board_platform ON posts(board_id, platform, published_at DESC);

-- 구인/협업 등 구조화 필드 보관용 JSONB
ALTER TABLE posts ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 검색 성능: pg_trgm 확장이 가능하면 GIN 인덱스 추가 (실패해도 무방)
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_posts_title_trgm ON posts USING gin (title gin_trgm_ops);

-- ── comments: 댓글 (대댓글 가능) ────────────────
CREATE TABLE IF NOT EXISTS comments (
  id              BIGSERIAL PRIMARY KEY,
  post_id         BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  parent_id       BIGINT REFERENCES comments(id) ON DELETE CASCADE,
  persona_id      VARCHAR(32) REFERENCES personas(id),
  author_nickname VARCHAR(64) NOT NULL,
  body            TEXT NOT NULL,
  like_count      INTEGER DEFAULT 0,
  is_ai           BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comments_post     ON comments(post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_persona  ON comments(persona_id, created_at DESC);

-- ── nickname_usage: 닉네임 회전 추적 ────────────
-- 같은 닉네임이 짧은 기간에 반복되지 않도록.
CREATE TABLE IF NOT EXISTS nickname_usage (
  id          BIGSERIAL PRIMARY KEY,
  persona_id  VARCHAR(32) NOT NULL REFERENCES personas(id),
  nickname    VARCHAR(64) NOT NULL,
  used_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nickname_usage    ON nickname_usage(persona_id, used_at DESC);

-- ── memory_threads: 페르소나의 컨텍스트 메모리 ─
-- 잔존율 KPI의 핵심. 페르소나가 과거 대화를 기억하는 데 사용.
-- "지난번에 말씀하신 그 광고 소재는 어떻게 됐나요?" 같은 개인화 질문 가능.
CREATE TABLE IF NOT EXISTS memory_threads (
  id              BIGSERIAL PRIMARY KEY,
  persona_id      VARCHAR(32) NOT NULL REFERENCES personas(id),
  topic_key       VARCHAR(128) NOT NULL,           -- 정규화된 주제 키
  summary         TEXT NOT NULL,                   -- 페르소나가 기억할 한 줄 요약
  related_post_id BIGINT REFERENCES posts(id) ON DELETE SET NULL,
  related_user    VARCHAR(64),                     -- 미래의 실 유저 식별자 (현재는 null)
  recall_count    INTEGER DEFAULT 0,               -- 몇 번 호출됐는지
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_memory_persona    ON memory_threads(persona_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_topic      ON memory_threads(topic_key);

-- ── engine_log: LLM 호출 추적 (신뢰도 90% KPI) ──
CREATE TABLE IF NOT EXISTS engine_log (
  id            BIGSERIAL PRIMARY KEY,
  task_type     VARCHAR(32) NOT NULL,              -- 'post' | 'comment'
  persona_id    VARCHAR(32),
  board_slug    VARCHAR(32),
  success       BOOLEAN NOT NULL,
  error_message TEXT,
  llm_model     VARCHAR(64),
  input_tokens  INTEGER,
  output_tokens INTEGER,
  duration_ms   INTEGER,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_engine_log_time   ON engine_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_engine_log_task   ON engine_log(task_type, success);

-- ── users: 실제 회원 ───────────────────────────
-- AI 페르소나와 별개. is_ai=false인 글/댓글의 작성자.
-- 첫 번째 가입자는 자동으로 admin role을 받는다 (api/auth.js에서 처리).
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  nickname      VARCHAR(64)  UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(16)  DEFAULT 'user',     -- 'user' | 'admin'
  is_active     BOOLEAN      DEFAULT TRUE,
  bio           TEXT,
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname);

-- posts/comments에 user_id 컬럼 추가 (실유저 글 식별용)
ALTER TABLE posts    ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_posts_user    ON posts(user_id)    WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id) WHERE user_id IS NOT NULL;

-- ── topic_seeds: 글감 풀 ───────────────────────
-- 메타 워커가 자동 생성하거나 수동으로 관리하는 글 주제 풀.
-- generatePost.js가 보드 선택 후 used_count가 가장 적은 시드를 우선 사용한다.
CREATE TABLE IF NOT EXISTS topic_seeds (
  id           BIGSERIAL PRIMARY KEY,
  board_slug   VARCHAR(32) NOT NULL,
  topic        TEXT NOT NULL,                       -- 글의 주제 한 줄
  angle        TEXT,                                -- 어떤 관점/스토리로 풀지 (선택)
  keywords     VARCHAR(255),                        -- 콤마 구분 핵심 키워드
  platform     VARCHAR(32),                         -- naver|kakao|meta|google|youtube|tiktok|coupang|smartstore|none
  used_count   INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  source       VARCHAR(32) DEFAULT 'manual',        -- 'manual' | 'meta_worker'
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_topic_seeds_board
  ON topic_seeds(board_slug, used_count, last_used_at NULLS FIRST);
CREATE INDEX IF NOT EXISTS idx_topic_seeds_platform
  ON topic_seeds(platform);

-- ── banners: 배너 슬롯별 이미지 ────────────────
-- 슬롯당 최대 5개 (애플리케이션 레벨에서 검증).
-- 이미지는 외부 URL OR 업로드된 BYTEA. 둘 중 하나 필수.
CREATE TABLE IF NOT EXISTS banners (
  id          BIGSERIAL PRIMARY KEY,
  slot        VARCHAR(32) NOT NULL,         -- top, inline, bottom, side1, side2
  image_url   TEXT,                         -- 외부 URL OR /api/banners/:id/image (자동 설정)
  image_data  BYTEA,                        -- 업로드된 이미지 바이너리 (선택)
  image_mime  VARCHAR(64),                  -- e.g., image/jpeg, image/png, image/webp
  link_url    TEXT,
  alt_text    VARCHAR(255),
  sort_order  INTEGER DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE,
  click_count INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_banners_slot
  ON banners(slot, sort_order) WHERE is_active = TRUE;

-- 기존 테이블에 컬럼 추가 (멱등)
ALTER TABLE banners ADD COLUMN IF NOT EXISTS image_data BYTEA;
ALTER TABLE banners ADD COLUMN IF NOT EXISTS image_mime VARCHAR(64);
-- image_url을 nullable로 (이미 nullable일 수 있음)
ALTER TABLE banners ALTER COLUMN image_url DROP NOT NULL;

-- ── post_images: 게시글 첨부 이미지 ─────────────
-- 글당 최대 5장. BYTEA로 저장 (배너와 동일 패턴).
CREATE TABLE IF NOT EXISTS post_images (
  id          BIGSERIAL PRIMARY KEY,
  post_id     BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  image_data  BYTEA NOT NULL,
  image_mime  VARCHAR(64) NOT NULL,
  file_name   VARCHAR(255),
  file_size   INTEGER,                          -- bytes
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_post_images_post ON post_images(post_id, sort_order);

-- ── reports: 신고 ──────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
  id          BIGSERIAL PRIMARY KEY,
  reporter_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  target_type VARCHAR(16) NOT NULL,             -- 'post' | 'comment'
  target_id   BIGINT NOT NULL,
  reason      VARCHAR(32) NOT NULL,             -- 'spam' | 'abuse' | 'inappropriate' | 'other'
  detail      TEXT,
  status      VARCHAR(16) DEFAULT 'pending',    -- 'pending' | 'resolved' | 'dismissed'
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);

-- ── password_resets: 비밀번호 재설정 토큰 ────────
CREATE TABLE IF NOT EXISTS password_resets (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       VARCHAR(128) UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pw_reset_token ON password_resets(token) WHERE used = FALSE;

-- ── likes: 좋아요 (게시글 + 댓글 겸용) ──────────
-- 유저당 한 번만. target_type + target_id로 다형성.
CREATE TABLE IF NOT EXISTS likes (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type VARCHAR(16) NOT NULL,              -- 'post' | 'comment'
  target_id   BIGINT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_target ON likes(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_likes_user   ON likes(user_id, created_at DESC);

-- ── resources: 다운로드 가능한 마케팅 자료 ─────
CREATE TABLE IF NOT EXISTS resources (
  id             BIGSERIAL PRIMARY KEY,
  slug           VARCHAR(128) UNIQUE NOT NULL,
  title          VARCHAR(255) NOT NULL,
  subtitle       VARCHAR(255),
  category       VARCHAR(32) NOT NULL,        -- 'copy-pack' | 'checklist' | 'cheatsheet' | 'workbook' | 'glossary'
  description    TEXT,                        -- 카드 설명용 (1-2줄)
  body           TEXT NOT NULL,               -- 본문 (마크다운/HTML)
  cover_gradient VARCHAR(64),                 -- '#ff3e5f,#c41635'
  read_time      INTEGER DEFAULT 5,
  view_count     INTEGER DEFAULT 0,
  download_count INTEGER DEFAULT 0,
  is_active      BOOLEAN DEFAULT TRUE,
  is_featured    BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_resources_category ON resources(category, is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resources_featured ON resources(is_featured DESC, view_count DESC) WHERE is_active = TRUE;

-- ── copy_gen_usage: 카피 생성기 레이트리밋 ─────
CREATE TABLE IF NOT EXISTS copy_gen_usage (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ip_hash     VARCHAR(64),                   -- 익명 사용자 추적용
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_copy_gen_user ON copy_gen_usage(user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_copy_gen_ip   ON copy_gen_usage(ip_hash, created_at DESC) WHERE ip_hash IS NOT NULL;

-- ── agencies: 광고대행사 디렉토리 ──────────────
CREATE TABLE IF NOT EXISTS agencies (
  id            BIGSERIAL PRIMARY KEY,
  slug          VARCHAR(128) UNIQUE NOT NULL,
  name          VARCHAR(128) NOT NULL,
  tagline       VARCHAR(255),                    -- 한 줄 소개
  description   TEXT,                            -- 상세 설명
  logo_url      TEXT,                            -- 로고 URL (선택)
  specialties   VARCHAR(255),                    -- 'naver,meta,coupang' 콤마 구분
  location      VARCHAR(64),                     -- '서울 강남', '서울 마포' 등
  team_size     VARCHAR(32),                     -- '1-5', '6-15', '16-50', '50+'
  founded_year  INTEGER,
  contact_email VARCHAR(255),
  contact_phone VARCHAR(64),
  website_url   TEXT,
  is_verified   BOOLEAN DEFAULT FALSE,           -- 운영자 인증 마크
  is_active     BOOLEAN DEFAULT TRUE,
  view_count    INTEGER DEFAULT 0,
  click_count   INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agencies_active ON agencies(is_active, is_verified DESC, view_count DESC);

-- ── stats_view: 사이드바 통계용 뷰 ─────────────
CREATE OR REPLACE VIEW stats_view AS
SELECT
  (SELECT COUNT(*) FROM posts)                                       AS total_posts,
  (SELECT COUNT(*) FROM comments)                                    AS total_comments,
  (SELECT COUNT(*) FROM posts WHERE published_at > NOW() - INTERVAL '24 hours') AS posts_today,
  (SELECT COUNT(*) FROM comments WHERE created_at > NOW() - INTERVAL '24 hours') AS comments_today;
