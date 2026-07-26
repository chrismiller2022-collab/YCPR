-- Safe to run any time, whether or not you've already created weekly_team_stats
-- and regardless of how many times you run it. Adds the columns needed to
-- match the full weekly CSV export (live record, ATS tracking, playoff
-- seeding, Draftkings natty odds, etc.) without touching any existing data.

alter table weekly_team_stats add column if not exists preseason_proj numeric;
alter table weekly_team_stats add column if not exists season_win_line numeric;
alter table weekly_team_stats add column if not exists change_from_preseason numeric;
alter table weekly_team_stats add column if not exists live_wins numeric;
alter table weekly_team_stats add column if not exists live_losses numeric;
alter table weekly_team_stats add column if not exists wins_left numeric;
alter table weekly_team_stats add column if not exists losses_left numeric;
alter table weekly_team_stats add column if not exists draftkings_natty_odds numeric;
alter table weekly_team_stats add column if not exists natty_rank int;
alter table weekly_team_stats add column if not exists playoff_seed int;
alter table weekly_team_stats add column if not exists ats_wins numeric;
alter table weekly_team_stats add column if not exists ats_losses numeric;
alter table weekly_team_stats add column if not exists games_completed numeric;
alter table weekly_team_stats add column if not exists ats_rank int;
alter table weekly_team_stats add column if not exists hfa numeric;
