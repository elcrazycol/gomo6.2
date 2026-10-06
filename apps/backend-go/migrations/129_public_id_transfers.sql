-- Ledger for public-number assignments and transfers (docs/wiki/PUBLIC_IDS.md §9).
--
-- The user line is the tradeable one: an admin can hand a specific number to a
-- user (a reserved one from the 1..9 band, a memorable one, or a number bought
-- from its previous owner). Every movement of a number is recorded here, because
-- after a transfer the old URL points at the new owner — without a ledger there
-- is no way to resolve a dispute or explain why /profile/1337 changed hands.
--
-- The table is append-only by convention: rows are never updated or deleted, and
-- the FKs use ON DELETE SET NULL so the history survives account deletion.
CREATE TABLE IF NOT EXISTS public_id_transfers (
    id           BIGSERIAL PRIMARY KEY,
    -- The number that moved.
    public_id    BIGINT NOT NULL,
    -- Who held it before (NULL when the number was unallocated — a reserved band
    -- number being handed out for the first time, or a fresh sequence value).
    from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    -- Who holds it now.
    to_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    -- The admin who performed the assignment.
    actor_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    note         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_id_transfers_public_id ON public_id_transfers(public_id);
CREATE INDEX IF NOT EXISTS idx_public_id_transfers_to_user ON public_id_transfers(to_user_id);
CREATE INDEX IF NOT EXISTS idx_public_id_transfers_created_at ON public_id_transfers(created_at DESC);
