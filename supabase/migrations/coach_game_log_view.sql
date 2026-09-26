-- Migration: coach_game_log_view (applied to project uyxnmtsntiaxqqmwsteq)
-- Every completed game each team has played under its CURRENT coach (team_coaches' latest season:
-- first_year_at_school onward), with the preferred-provider line (same order as matchupsCompute's
-- pickLine: consensus, DraftKings, Bovada, else first) oriented to the team (negative = team favored).
-- Only seasons present in `games` show up — backfill older seasons via Games & Lines to go further back.
create or replace view coach_game_log with (security_invoker = true) as
with best_line as (
  select distinct on (game_id) game_id, provider, spread, opening_spread, over_under
  from betting_lines
  order by game_id, array_position(array['consensus','DraftKings','Bovada'], provider) nulls last, id
),
current_coach as (
  select * from team_coaches where season = (select max(season) from team_coaches)
)
select
  cc.team, cc.coach_name, cc.first_year_at_school, cc.tenure_seasons,
  g.id as game_id, g.season, g.week, g.season_type, g.start_date, g.neutral_site,
  case when g.neutral_site then 'neutral' when g.home_team = cc.team then 'home' else 'away' end as location,
  case when g.home_team = cc.team then g.away_team else g.home_team end as opponent,
  case when g.home_team = cc.team then g.home_points else g.away_points end as team_points,
  case when g.home_team = cc.team then g.away_points else g.home_points end as opp_points,
  case when g.home_team = cc.team then bl.spread else -bl.spread end as close_spread,
  case when g.home_team = cc.team then bl.opening_spread else -bl.opening_spread end as open_spread,
  bl.provider as line_provider
from current_coach cc
join games g
  on (g.home_team = cc.team or g.away_team = cc.team)
 and g.season >= cc.first_year_at_school
 and g.completed
 and g.home_points is not null and g.away_points is not null
left join best_line bl on bl.game_id = g.id;
