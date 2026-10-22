-- Where a game's final score came from: 'espn' (saved by the bot's 5-minute cycle from ESPN's free scoreboard)
-- or 'cfbd' (CFBD sync). CFBD overwrites an ESPN final once CFBD has its own; until then CFBD keeps ESPN's.
alter table games add column if not exists score_source text check (score_source is null or score_source in ('espn', 'cfbd'));
