-- 148_drop_depay_tables.sql
--
-- DePay removal: the purchase flow (packages + pending payment intents) is
-- gone with the provider. drops_transactions stays — it is the shared ledger
-- for gifts, transfers and quest rewards, not a DePay table.
--
-- Idempotent — safe on any DB state.

DROP TABLE IF EXISTS drops_pending;
DROP TABLE IF EXISTS drops_packages;
