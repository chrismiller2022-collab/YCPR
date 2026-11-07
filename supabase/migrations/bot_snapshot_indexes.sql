-- Migration: bot_snapshot_indexes. Applied to project uyxnmtsntiaxqqmwsteq (created concurrently, outside a transaction).
-- The dashboard's per-game history ("newest 1,500 snapshots for this game", order by id desc) walked the whole primary
-- key backwards: 23 s on bot_mkt_snaps (1.2M rows), past the statement timeout. Its desk feed ("newest 3,000 snapshots
-- for the watched games", order by taken_at desc) read all of bot_snapshots each refresh.
create index concurrently if not exists bot_mkt_snaps_game_id_desc on bot_mkt_snaps (game_id, id desc);
create index concurrently if not exists bot_snapshots_game_id_desc on bot_snapshots (game_id, id desc);
create index concurrently if not exists bot_snapshots_taken_at_desc on bot_snapshots (taken_at desc);
