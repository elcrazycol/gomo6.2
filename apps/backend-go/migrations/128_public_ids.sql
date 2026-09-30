-- Public identifiers («цифорки»): короткие числовые public_id для людей, тем и
-- постов на стене профиля.
--
-- Зачем: UUID в URL (profile/<uuid>, thread/<uuid>) уродлив и нечитаем. public_id —
-- это человекочитаемый номер, который постепенно становится основным в ссылках.
--
-- Инварианты (не ломать!):
--   1. public_id НИКОГДА не участвует в авторизации/ownership — все IDOR-предикаты
--      остаются на UUID (user_id/author_id). public_id — только резолв и отображение.
--   2. Нумерация per-table: у каждой таблицы свой sequence. Общий счётчик съедался бы
--      контентом и убил бы «низкий номер = старичок» на линии юзеров.
--   3. Порядок номеров = порядок created_at. Пересчёт/офсет задним числом ломает все
--      уже разошедшиеся ссылки, так что это one-shot решение.
--   4. Базы у линий РАЗНЫЕ, и это осознанно:
--        users              → 10  (1..9 держим под систему и основателей);
--        threads            → 100 (1..99 держим, чтобы тестовый и служебный мусор не
--                                   выжигал видимый низ: треды удаляются жёстко,
--                                   sequence номер не возвращает, и дыры остались бы
--                                   на самом видном месте);
--        profile_wall_posts → 1   (на него плевать — престижа в номере поста стены нет).
--      Номер, который sequence не выдаёт, недостижим по построению — база и есть
--      «резерв». Отдельный реестр резерва не нужен.
--   5. Короткие номера юзеров — распределённый престиж: 2–3-значные получают первые
--      живые юзеры, а не платформа. Поэтому база 10, а не 100: низкие номера должны
--      быть в руках людей — это и есть актив, который потом перепродают между собой.
--   6. Используем обычный SEQUENCE + DEFAULT nextval, а не GENERATED ... AS IDENTITY:
--      identity нельзя чеканить явным INSERT без OVERRIDING SYSTEM VALUE и её
--      неудобно переназначать, а выдача конкретного номера — это UPDATE public_id.
--   7. public_id не должен попадать в клиентские write-пути (WritableColumns /
--      typed update-структуры). Назначение номеров — только админский путь.
--
-- posts (посты в тредах) здесь СОЗНАТЕЛЬНО не нумеруются: ссылок по ним ещё нет, а
-- базы one-shot — их линию заведём отдельной миграцией, когда решим.
--
-- Существующие строки нумеруются от базы вверх по created_at, поэтому самые старые
-- получают самые низкие номера линии.

-- ── users ───────────────────────────────────────────────────────────────────
-- База 10: 1..9 держим под систему/основателей. Первый живой юзер получает 10.
CREATE SEQUENCE IF NOT EXISTS users_public_id_seq START WITH 10;
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_id BIGINT;
UPDATE users u SET public_id = s.rn + 9
FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM users WHERE public_id IS NULL) s
WHERE u.id = s.id AND u.public_id IS NULL;
ALTER TABLE users ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE users ALTER COLUMN public_id SET DEFAULT nextval('users_public_id_seq');
ALTER SEQUENCE users_public_id_seq OWNED BY users.public_id;
-- setval только при непустой таблице: на пустой sequence остаётся на своей базе,
-- то есть первый nextval вернёт ровно базу, а не базу+1.
SELECT setval('users_public_id_seq', (SELECT MAX(public_id) FROM users))
WHERE EXISTS (SELECT 1 FROM users);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_public_id ON users(public_id);

-- ── threads ─────────────────────────────────────────────────────────────────
-- База 100: 1..99 держим чистым под редакционку (welcome/rules/FAQ) и под то, что
-- не должно занимать видный низ, пока идут тесты и первые удаления.
CREATE SEQUENCE IF NOT EXISTS threads_public_id_seq START WITH 100;
ALTER TABLE threads ADD COLUMN IF NOT EXISTS public_id BIGINT;
UPDATE threads t SET public_id = s.rn + 99
FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM threads WHERE public_id IS NULL) s
WHERE t.id = s.id AND t.public_id IS NULL;
ALTER TABLE threads ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE threads ALTER COLUMN public_id SET DEFAULT nextval('threads_public_id_seq');
ALTER SEQUENCE threads_public_id_seq OWNED BY threads.public_id;
SELECT setval('threads_public_id_seq', (SELECT MAX(public_id) FROM threads))
WHERE EXISTS (SELECT 1 FROM threads);
CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_public_id ON threads(public_id);

-- ── profile_wall_posts ──────────────────────────────────────────────────────
-- База 1: номер поста стены — служебный (URL всё равно скоупится владельцем стены
-- в /profile/<userNum>/wall/<postNum>), резерва и престижа тут нет.
CREATE SEQUENCE IF NOT EXISTS profile_wall_posts_public_id_seq START WITH 1;
ALTER TABLE profile_wall_posts ADD COLUMN IF NOT EXISTS public_id BIGINT;
UPDATE profile_wall_posts w SET public_id = s.rn
FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM profile_wall_posts WHERE public_id IS NULL) s
WHERE w.id = s.id AND w.public_id IS NULL;
ALTER TABLE profile_wall_posts ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE profile_wall_posts ALTER COLUMN public_id SET DEFAULT nextval('profile_wall_posts_public_id_seq');
ALTER SEQUENCE profile_wall_posts_public_id_seq OWNED BY profile_wall_posts.public_id;
SELECT setval('profile_wall_posts_public_id_seq', (SELECT MAX(public_id) FROM profile_wall_posts))
WHERE EXISTS (SELECT 1 FROM profile_wall_posts);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_wall_posts_public_id ON profile_wall_posts(public_id);

-- ── profiles view: public_id должен быть виден в джойнах ────────────────────
-- Колонки повторяют актуальное определение из 091_unified_user_stats.sql
-- (последняя пересборка вью) плюс public_id. DROP обязателен: PostgreSQL не
-- умеет добавлять колонку через CREATE OR REPLACE VIEW.
DROP VIEW IF EXISTS profiles;
CREATE OR REPLACE VIEW profiles AS
SELECT
    id, username, display_name, email, password_hash, domain,
    avatar_url, bio, bio_json, garma, post_count, thread_count,
    wall_post_count, comment_count, likes_received_count, likes_given_count,
    drops, wallet_address,
    is_remote, is_anonymous, is_online, last_seen_at, account_number,
    search_vector,
    nickname_emoji_id,
    public_id,
    created_at, updated_at
FROM users;

GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO gomo6;
