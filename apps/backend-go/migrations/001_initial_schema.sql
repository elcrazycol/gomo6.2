-- Initial schema for Gomo6 backend with federation support

-- Users table with federation
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    domain VARCHAR(255) NOT NULL DEFAULT 'localhost:8080',
    avatar_url TEXT,
    bio TEXT,
    garma INTEGER DEFAULT 0,
    post_count INTEGER DEFAULT 0,
    thread_count INTEGER DEFAULT 0,
    is_remote BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Boards table (local boards)
CREATE TABLE IF NOT EXISTS boards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_gomosub BOOLEAN DEFAULT FALSE,
    is_rules_board BOOLEAN DEFAULT FALSE,
    owner_id UUID REFERENCES users(id),
    gomosub_avatar_url TEXT,
    cover_image_url TEXT,
    gomosub_tags JSONB DEFAULT '[]',
    rules_markdown TEXT,
    rules_updated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- GomoSubs table (global communities)
CREATE TABLE IF NOT EXISTS gomosubs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    server_domain VARCHAR(255) NOT NULL,
    owner_id UUID NOT NULL,
    avatar_url TEXT,
    cover_image_url TEXT,
    tags JSONB DEFAULT '[]',
    is_remote BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Threads table with federation
CREATE TABLE IF NOT EXISTS threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id UUID NOT NULL REFERENCES boards(id),
    user_id UUID REFERENCES users(id),
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    image_url TEXT,
    image_urls JSONB DEFAULT '[]',
    post_count INTEGER DEFAULT 0,
    server_domain VARCHAR(255) NOT NULL DEFAULT 'localhost:8080',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_remote BOOLEAN DEFAULT FALSE
);

-- Posts table with federation
CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES threads(id),
    user_id UUID REFERENCES users(id),
    content TEXT NOT NULL,
    image_url TEXT,
    image_urls JSONB DEFAULT '[]',
    reply_to UUID REFERENCES posts(id),
    is_private BOOLEAN DEFAULT FALSE,
    private_recipient_id UUID REFERENCES users(id),
    server_domain VARCHAR(255) NOT NULL DEFAULT 'localhost:8080',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_remote BOOLEAN DEFAULT FALSE
);

-- Post likes
CREATE TABLE IF NOT EXISTS post_likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES posts(id),
    user_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(post_id, user_id)
);

-- Thread likes
CREATE TABLE IF NOT EXISTS thread_likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES threads(id),
    user_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(thread_id, user_id)
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    type VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    related_thread_id UUID REFERENCES threads(id),
    related_post_id UUID REFERENCES posts(id),
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Achievements
CREATE TABLE IF NOT EXISTS achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(255) NOT NULL,
    icon TEXT,
    reward_type VARCHAR(255),
    reward_value VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User achievements
CREATE TABLE IF NOT EXISTS user_achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    achievement_id UUID NOT NULL REFERENCES achievements(id),
    unlocked_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(user_id, achievement_id)
);

-- Federation servers
CREATE TABLE IF NOT EXISTS federation_servers (
    domain VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    version VARCHAR(255),
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_online BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_username_domain ON users(username, domain);
CREATE INDEX IF NOT EXISTS idx_users_domain ON users(domain);
CREATE INDEX IF NOT EXISTS idx_boards_slug ON boards(slug);
CREATE INDEX IF NOT EXISTS idx_gomosubs_slug ON gomosubs(slug);
CREATE INDEX IF NOT EXISTS idx_gomosubs_server_domain ON gomosubs(server_domain);
CREATE INDEX IF NOT EXISTS idx_threads_board_id ON threads(board_id);
CREATE INDEX IF NOT EXISTS idx_threads_server_domain ON threads(server_domain);
CREATE INDEX IF NOT EXISTS idx_posts_thread_id ON posts(thread_id);
CREATE INDEX IF NOT EXISTS idx_posts_server_domain ON posts(server_domain);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);

-- Insert default data
INSERT INTO achievements (name, description, category, icon, reward_type, reward_value) VALUES
('Первый пост', 'Создайте свой первый пост', 'posting', '📝', 'garma', '10'),
('Первый тред', 'Создайте свой первый тред', 'posting', '🧵', 'garma', '25'),
('Популярный тред', 'Создайте тред с 10+ постами', 'engagement', '🔥', 'garma', '50'),
('Помощник', 'Получите 5 лайков на своих постах', 'engagement', '👍', 'garma', '30');

-- Create default rules board
INSERT INTO boards (slug, name, description, is_rules_board, created_at) VALUES
('rules', 'Правила', 'Правила форума Gomo6', TRUE, NOW());
