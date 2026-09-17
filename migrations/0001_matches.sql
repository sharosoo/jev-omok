-- Match history and per-player aggregates.
--
-- Aggregates are maintained on write rather than computed on read: a profile
-- screen is read far more often than a match finishes, and D1's free tier is
-- far more generous with row reads (5M/day) than writes (100k/day), so one
-- upsert per finished match is cheaper than scanning a player's history on
-- every page view.

CREATE TABLE IF NOT EXISTS matches (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL,
  rule         TEXT NOT NULL,
  black_id     TEXT NOT NULL,
  black_name   TEXT NOT NULL,
  white_id     TEXT NOT NULL,
  white_name   TEXT NOT NULL,
  -- 'black', 'white' or NULL for a draw.
  winner       TEXT,
  reason       TEXT NOT NULL,
  plies        INTEGER NOT NULL,
  started_at   INTEGER NOT NULL,
  finished_at  INTEGER NOT NULL,
  -- Whole game as notation, e.g. 'H8 I9 J8'. A packed blob keeps one row per
  -- match instead of one per move, which matters against the write quota.
  moves        TEXT NOT NULL
);

-- Profile queries are "this player's latest matches", so both seats need an
-- index; SQLite will not use a single composite index for either side.
CREATE INDEX IF NOT EXISTS matches_black ON matches (black_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS matches_white ON matches (white_id, finished_at DESC);

CREATE TABLE IF NOT EXISTS player_stats (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  wins           INTEGER NOT NULL DEFAULT 0,
  losses         INTEGER NOT NULL DEFAULT 0,
  draws          INTEGER NOT NULL DEFAULT 0,
  played         INTEGER NOT NULL DEFAULT 0,
  streak         INTEGER NOT NULL DEFAULT 0,
  best_streak    INTEGER NOT NULL DEFAULT 0,
  last_played_at INTEGER
);

-- Leaderboard ordering. Wins first, then fewer losses, so a player who never
-- loses outranks one with the same wins and many losses.
CREATE INDEX IF NOT EXISTS player_stats_rank ON player_stats (wins DESC, losses ASC);
