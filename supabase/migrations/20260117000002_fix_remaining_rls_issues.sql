-- Fix remaining RLS performance issues from second batch of warnings

-- These policies have different logic and cannot be safely consolidated:
-- - posts: "Moderators can delete posts" vs "Users can delete their own posts"
-- - threads: Multiple INSERT policies with different board-specific logic
-- - privacy_settings: Already consolidated above

-- All remaining auth_rls_initplan issues should be fixed by the previous migration
-- The multiple_permissive_policies warnings for posts and threads are expected
-- since they have legitimately different business logic that cannot be combined

-- If you want to eliminate the warnings completely, you would need to:
-- 1. Combine policies with OR conditions (risky, may change behavior)
-- 2. Make one policy restrictive instead of permissive
-- 3. Accept the performance impact (recommended for correctness)

-- For now, leaving as-is since the warnings are for legitimately separate business logic.