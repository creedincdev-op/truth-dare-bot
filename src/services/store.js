const fs = require("node:fs");
const path = require("node:path");
const initSqlJs = require("sql.js");
const { DEFAULT_GUILD_CONFIG } = require("../questions/catalog");

function locateSqlWasm(file) {
  const wasmDir = path.dirname(require.resolve("sql.js/dist/sql-wasm.js"));
  return path.join(wasmDir, file);
}

function toJson(value) {
  return JSON.stringify(value || []);
}

function fromJson(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

class BotStore {
  static async create(filePath) {
    const SQL = await initSqlJs({ locateFile: locateSqlWasm });
    const resolvedPath = path.resolve(filePath);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

    let db;
    if (fs.existsSync(resolvedPath)) {
      const payload = fs.readFileSync(resolvedPath);
      db = new SQL.Database(payload);
    } else {
      db = new SQL.Database();
    }

    const store = new BotStore(db, resolvedPath);
    store.initializeSchema();
    store.persist();
    return store;
  }

  constructor(db, filePath) {
    this.db = db;
    this.filePath = filePath;
  }

  persist() {
    const data = Buffer.from(this.db.export());
    fs.writeFileSync(this.filePath, data);
  }

  initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        default_rating TEXT NOT NULL,
        max_prompt_length INTEGER NOT NULL,
        button_timeout_seconds INTEGER NOT NULL,
        disabled_categories TEXT NOT NULL,
        disabled_games TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS emitted_prompts (
        prompt_id TEXT PRIMARY KEY,
        prompt_key TEXT NOT NULL,
        text TEXT NOT NULL,
        game TEXT NOT NULL,
        category TEXT NOT NULL,
        rating TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        requester_id TEXT,
        source TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_emitted_prompts_scope
      ON emitted_prompts (guild_id, channel_id, game, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_emitted_prompts_prompt_key
      ON emitted_prompts (guild_id, game, channel_id, prompt_key);

      CREATE TABLE IF NOT EXISTS prompt_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prompt_id TEXT NOT NULL,
        prompt_key TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        reason TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS prompt_blacklist (
        prompt_key TEXT PRIMARY KEY,
        prompt_id TEXT,
        reason TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        game TEXT NOT NULL,
        category TEXT NOT NULL,
        rating TEXT NOT NULL,
        created_by TEXT NOT NULL,
        state_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_channel
      ON sessions (guild_id, channel_id, status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS paranoia_rounds (
        round_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        requester_id TEXT NOT NULL,
        target_user_id TEXT NOT NULL,
        prompt_id TEXT NOT NULL,
        prompt_key TEXT NOT NULL,
        state_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_paranoia_rounds_target
      ON paranoia_rounds (target_user_id, status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS daily_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        game TEXT NOT NULL,
        category TEXT NOT NULL,
        rating TEXT NOT NULL,
        time_hhmm TEXT NOT NULL,
        timezone TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_local_date TEXT,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  getRow(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return row;
  }

  getRows(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  run(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.run(params);
    stmt.free();
    this.persist();
  }

  getGuildConfig(guildId) {
    const row = this.getRow(
      `SELECT default_rating, max_prompt_length, button_timeout_seconds, disabled_categories, disabled_games
       FROM guild_settings
       WHERE guild_id = ?`,
      [guildId],
    );

    if (!row) {
      return { ...DEFAULT_GUILD_CONFIG };
    }

    return {
      defaultRating: row.default_rating || DEFAULT_GUILD_CONFIG.defaultRating,
      maxPromptLength: Number(row.max_prompt_length) || DEFAULT_GUILD_CONFIG.maxPromptLength,
      buttonTimeoutSeconds: Number(row.button_timeout_seconds) || DEFAULT_GUILD_CONFIG.buttonTimeoutSeconds,
      disabledCategories: fromJson(row.disabled_categories, []),
      disabledGames: fromJson(row.disabled_games, []),
    };
  }

  upsertGuildConfig(guildId, partialConfig) {
    const current = this.getGuildConfig(guildId);
    const next = {
      ...current,
      ...partialConfig,
    };
    const now = Date.now();

    this.run(
      `INSERT INTO guild_settings (
        guild_id,
        default_rating,
        max_prompt_length,
        button_timeout_seconds,
        disabled_categories,
        disabled_games,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        default_rating = excluded.default_rating,
        max_prompt_length = excluded.max_prompt_length,
        button_timeout_seconds = excluded.button_timeout_seconds,
        disabled_categories = excluded.disabled_categories,
        disabled_games = excluded.disabled_games,
        updated_at = excluded.updated_at`,
      [
        guildId,
        next.defaultRating,
        next.maxPromptLength,
        next.buttonTimeoutSeconds,
        toJson(next.disabledCategories),
        toJson(next.disabledGames),
        now,
      ],
    );

    return next;
  }

  toggleDisabledCategory(guildId, category, disabled) {
    const config = this.getGuildConfig(guildId);
    const set = new Set(config.disabledCategories);
    if (disabled) {
      set.add(category);
    } else {
      set.delete(category);
    }
    return this.upsertGuildConfig(guildId, { disabledCategories: [...set].sort() });
  }

  toggleDisabledGame(guildId, game, disabled) {
    const config = this.getGuildConfig(guildId);
    const set = new Set(config.disabledGames);
    if (disabled) {
      set.add(game);
    } else {
      set.delete(game);
    }
    return this.upsertGuildConfig(guildId, { disabledGames: [...set].sort() });
  }

  getBlacklistedKeys() {
    return new Set(this.getRows(`SELECT prompt_key FROM prompt_blacklist`).map((row) => row.prompt_key));
  }

  recordPromptEmission(prompt, scope) {
    this.run(
      `INSERT INTO emitted_prompts (
        prompt_id,
        prompt_key,
        text,
        game,
        category,
        rating,
        guild_id,
        channel_id,
        requester_id,
        source,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        prompt.id,
        prompt.key,
        prompt.text,
        prompt.game,
        prompt.category,
        prompt.rating,
        scope.guildId,
        scope.channelId,
        scope.requesterId || null,
        prompt.source || "local",
        Date.now(),
      ],
    );
  }

  getRecentPromptKeys({ guildId, channelId = null, games, limit = 80, scope = "channel" }) {
    const targetGames = Array.isArray(games) && games.length > 0 ? games : [];
    if (targetGames.length === 0) {
      return [];
    }

    const placeholders = targetGames.map(() => "?").join(", ");
    const sql = scope === "guild"
      ? `SELECT prompt_key
         FROM emitted_prompts
         WHERE guild_id = ?
           AND game IN (${placeholders})
         ORDER BY created_at DESC
         LIMIT ?`
      : `SELECT prompt_key
         FROM emitted_prompts
         WHERE guild_id = ?
           AND channel_id = ?
           AND game IN (${placeholders})
         ORDER BY created_at DESC
         LIMIT ?`;
    const params = scope === "guild"
      ? [guildId, ...targetGames, limit]
      : [guildId, channelId, ...targetGames, limit];
    const rows = this.getRows(sql, params);

    return rows.map((row) => row.prompt_key);
  }

  getRecentPromptEntries({ guildId, channelId = null, games, limit = 25, scope = "channel" }) {
    const targetGames = Array.isArray(games) && games.length > 0 ? games : [];
    if (targetGames.length === 0) {
      return [];
    }

    const placeholders = targetGames.map(() => "?").join(", ");
    const sql = scope === "guild"
      ? `SELECT prompt_key, text, category, game
         FROM emitted_prompts
         WHERE guild_id = ?
           AND game IN (${placeholders})
         ORDER BY created_at DESC
         LIMIT ?`
      : `SELECT prompt_key, text, category, game
         FROM emitted_prompts
         WHERE guild_id = ?
           AND channel_id = ?
           AND game IN (${placeholders})
         ORDER BY created_at DESC
         LIMIT ?`;
    const params = scope === "guild"
      ? [guildId, ...targetGames, limit]
      : [guildId, channelId, ...targetGames, limit];
    const rows = this.getRows(sql, params);

    return rows.map((row) => ({
      key: row.prompt_key,
      text: row.text,
      category: row.category,
      game: row.game,
    }));
  }

  getUsedPromptKeys({ guildId, channelId = null, games, scope = "channel" }) {
    const targetGames = Array.isArray(games) && games.length > 0 ? games : [];
    if (targetGames.length === 0) {
      return [];
    }

    const placeholders = targetGames.map(() => "?").join(", ");
    const sql = scope === "guild"
      ? `SELECT DISTINCT prompt_key
         FROM emitted_prompts
         WHERE guild_id = ?
           AND game IN (${placeholders})`
      : `SELECT DISTINCT prompt_key
         FROM emitted_prompts
         WHERE guild_id = ?
           AND channel_id = ?
           AND game IN (${placeholders})`;
    const params = scope === "guild"
      ? [guildId, ...targetGames]
      : [guildId, channelId, ...targetGames];
    const rows = this.getRows(sql, params);

    return rows.map((row) => row.prompt_key);
  }

  getPromptUsageStats({ guildId, channelId = null, games, scope = "channel" }) {
    const targetGames = Array.isArray(games) && games.length > 0 ? games : [];
    if (targetGames.length === 0) {
      return [];
    }

    const placeholders = targetGames.map(() => "?").join(", ");
    const sql = scope === "guild"
      ? `SELECT prompt_key, COUNT(*) AS use_count, MAX(created_at) AS last_used_at
         FROM emitted_prompts
         WHERE guild_id = ?
           AND game IN (${placeholders})
         GROUP BY prompt_key`
      : `SELECT prompt_key, COUNT(*) AS use_count, MAX(created_at) AS last_used_at
         FROM emitted_prompts
         WHERE guild_id = ?
           AND channel_id = ?
           AND game IN (${placeholders})
         GROUP BY prompt_key`;
    const params = scope === "guild"
      ? [guildId, ...targetGames]
      : [guildId, channelId, ...targetGames];
    const rows = this.getRows(sql, params);

    return rows.map((row) => ({
      key: row.prompt_key,
      count: Number(row.use_count) || 0,
      lastUsedAt: Number(row.last_used_at) || 0,
    }));
  }

  getPromptStats(guildId, channelId) {
    const emitted = this.getRow(
      `SELECT COUNT(*) AS total FROM emitted_prompts WHERE guild_id = ? AND channel_id = ?`,
      [guildId, channelId],
    );
    const reports = this.getRow(`SELECT COUNT(*) AS total FROM prompt_reports WHERE guild_id = ?`, [guildId]);
    const blacklisted = this.getRow(`SELECT COUNT(*) AS total FROM prompt_blacklist`, []);

    return {
      emitted: Number(emitted && emitted.total) || 0,
      reports: Number(reports && reports.total) || 0,
      blacklisted: Number(blacklisted && blacklisted.total) || 0,
    };
  }

  getEmittedPrompt(promptId) {
    return this.getRow(
      `SELECT prompt_id, prompt_key, text, game, category, rating, guild_id, channel_id
       FROM emitted_prompts
       WHERE prompt_id = ?`,
      [promptId],
    );
  }

  hasUserReportedPrompt(promptId, userId) {
    const row = this.getRow(
      `SELECT id FROM prompt_reports WHERE prompt_id = ? AND user_id = ? LIMIT 1`,
      [promptId, userId],
    );
    return Boolean(row);
  }

  reportPrompt(promptId, userId, reason = "Reported from button") {
    const prompt = this.getEmittedPrompt(promptId);
    if (!prompt) {
      return null;
    }

    if (this.hasUserReportedPrompt(promptId, userId)) {
      return { ...prompt, duplicate: true };
    }

    const now = Date.now();
    this.run(
      `INSERT INTO prompt_reports (
        prompt_id,
        prompt_key,
        guild_id,
        channel_id,
        user_id,
        reason,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [prompt.prompt_id, prompt.prompt_key, prompt.guild_id, prompt.channel_id, userId, reason, now],
    );

    this.run(
      `INSERT OR REPLACE INTO prompt_blacklist (
        prompt_key,
        prompt_id,
        reason,
        created_at
      ) VALUES (?, ?, ?, ?)`,
      [prompt.prompt_key, prompt.prompt_id, reason, now],
    );

    return { ...prompt, duplicate: false };
  }

  createSession(session) {
    const now = Date.now();
    this.run(
      `INSERT INTO sessions (
        session_id,
        guild_id,
        channel_id,
        mode,
        game,
        category,
        rating,
        created_by,
        state_json,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.sessionId,
        session.guildId,
        session.channelId,
        session.mode,
        session.game,
        session.category,
        session.rating,
        session.createdBy,
        JSON.stringify(session.state),
        session.status,
        now,
        now,
      ],
    );
  }

  getSession(sessionId) {
    const row = this.getRow(
      `SELECT session_id, guild_id, channel_id, mode, game, category, rating, created_by, state_json, status, created_at, updated_at
       FROM sessions
       WHERE session_id = ?`,
      [sessionId],
    );

    if (!row) {
      return null;
    }

    return {
      sessionId: row.session_id,
      guildId: row.guild_id,
      channelId: row.channel_id,
      mode: row.mode,
      game: row.game,
      category: row.category,
      rating: row.rating,
      createdBy: row.created_by,
      state: fromJson(row.state_json, {}),
      status: row.status,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  updateSession(sessionId, updater) {
    const session = this.getSession(sessionId);
    if (!session) {
      return null;
    }

    const next = updater({ ...session, state: { ...session.state } });
    const updatedAt = Date.now();
    this.run(
      `UPDATE sessions
       SET state_json = ?, status = ?, updated_at = ?
       WHERE session_id = ?`,
      [JSON.stringify(next.state), next.status, updatedAt, sessionId],
    );
    return this.getSession(sessionId);
  }

  endSession(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) {
      return null;
    }

    this.run(
      `UPDATE sessions SET status = ?, updated_at = ? WHERE session_id = ?`,
      ["ended", Date.now(), sessionId],
    );

    return this.getSession(sessionId);
  }

  createParanoiaRound(round) {
    const now = Date.now();
    this.run(
      `INSERT INTO paranoia_rounds (
        round_id,
        guild_id,
        channel_id,
        requester_id,
        target_user_id,
        prompt_id,
        prompt_key,
        state_json,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        round.roundId,
        round.guildId,
        round.channelId,
        round.requesterId,
        round.targetUserId,
        round.prompt.id,
        round.prompt.key,
        JSON.stringify(round.state || {}),
        round.status || "pending_dm",
        now,
        now,
      ],
    );
  }

  getParanoiaRound(roundId) {
    const row = this.getRow(
      `SELECT round_id, guild_id, channel_id, requester_id, target_user_id, prompt_id, prompt_key, state_json, status, created_at, updated_at
       FROM paranoia_rounds
       WHERE round_id = ?`,
      [roundId],
    );

    if (!row) {
      return null;
    }

    const state = fromJson(row.state_json, {});
    return {
      roundId: row.round_id,
      guildId: row.guild_id,
      channelId: row.channel_id,
      requesterId: row.requester_id,
      targetUserId: row.target_user_id,
      promptId: row.prompt_id,
      promptKey: row.prompt_key,
      prompt: state.prompt || null,
      state,
      status: row.status,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  updateParanoiaRound(roundId, updater) {
    const round = this.getParanoiaRound(roundId);
    if (!round) {
      return null;
    }

    const next = updater({
      ...round,
      state: { ...round.state },
    });

    this.run(
      `UPDATE paranoia_rounds
       SET state_json = ?, status = ?, updated_at = ?
       WHERE round_id = ?`,
      [
        JSON.stringify(next.state),
        next.status,
        Date.now(),
        roundId,
      ],
    );

    return this.getParanoiaRound(roundId);
  }

  saveSchedule(schedule) {
    const now = Date.now();
    this.run(
      `INSERT INTO daily_schedules (
        guild_id,
        channel_id,
        game,
        category,
        rating,
        time_hhmm,
        timezone,
        enabled,
        last_run_local_date,
        created_by,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schedule.guildId,
        schedule.channelId,
        schedule.game,
        schedule.category,
        schedule.rating,
        schedule.time,
        schedule.timezone,
        schedule.enabled ? 1 : 0,
        null,
        schedule.createdBy,
        now,
        now,
      ],
    );
  }

  listSchedules(guildId) {
    const rows = this.getRows(
      `SELECT id, guild_id, channel_id, game, category, rating, time_hhmm, timezone, enabled, last_run_local_date
       FROM daily_schedules
       WHERE guild_id = ?
       ORDER BY id ASC`,
      [guildId],
    );

    return rows.map((row) => ({
      id: Number(row.id),
      guildId: row.guild_id,
      channelId: row.channel_id,
      game: row.game,
      category: row.category,
      rating: row.rating,
      time: row.time_hhmm,
      timezone: row.timezone,
      enabled: Number(row.enabled) === 1,
      lastRunLocalDate: row.last_run_local_date || null,
    }));
  }

  getEnabledSchedules() {
    const rows = this.getRows(
      `SELECT id, guild_id, channel_id, game, category, rating, time_hhmm, timezone, enabled, last_run_local_date
       FROM daily_schedules
       WHERE enabled = 1`,
      [],
    );

    return rows.map((row) => ({
      id: Number(row.id),
      guildId: row.guild_id,
      channelId: row.channel_id,
      game: row.game,
      category: row.category,
      rating: row.rating,
      time: row.time_hhmm,
      timezone: row.timezone,
      enabled: Number(row.enabled) === 1,
      lastRunLocalDate: row.last_run_local_date || null,
    }));
  }

  deleteSchedule(guildId, id) {
    this.run(`DELETE FROM daily_schedules WHERE guild_id = ? AND id = ?`, [guildId, id]);
  }

  markScheduleRun(id, localDate) {
    this.run(
      `UPDATE daily_schedules SET last_run_local_date = ?, updated_at = ? WHERE id = ?`,
      [localDate, Date.now(), id],
    );
  }
}

module.exports = {
  BotStore,
};
