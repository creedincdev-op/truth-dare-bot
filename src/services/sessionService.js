const { shortId } = require("../utils/random");
const { GAME_LABELS } = require("../questions/catalog");

function createEmptyPlayer(user) {
  return {
    name: user.globalName || user.username || user.id,
    score: 0,
    streak: 0,
    bestStreak: 0,
  };
}

class SessionService {
  constructor(store) {
    this.store = store;
  }

  startSession({ guildId, channelId, mode, game, category, rating, rounds, durationMinutes, createdBy, prompt }) {
    const sessionId = shortId("session");
    const now = Date.now();
    const state = {
      prompt,
      round: 1,
      rounds: rounds || 10,
      durationMinutes: durationMinutes || 10,
      endsAt: mode === "timer" ? now + ((durationMinutes || 10) * 60 * 1000) : null,
      players: {},
    };

    this.store.createSession({
      sessionId,
      guildId,
      channelId,
      mode,
      game,
      category,
      rating,
      createdBy,
      state,
      status: "active",
    });

    return this.store.getSession(sessionId);
  }

  joinSession(sessionId, user) {
    return this.store.updateSession(sessionId, (session) => {
      if (!session.state.players[user.id]) {
        session.state.players[user.id] = createEmptyPlayer(user);
      }
      return session;
    });
  }

  recordComplete(sessionId, user) {
    return this.store.updateSession(sessionId, (session) => {
      if (!session.state.players[user.id]) {
        session.state.players[user.id] = createEmptyPlayer(user);
      }

      const player = session.state.players[user.id];

      if (session.mode === "streak") {
        player.streak += 1;
        player.bestStreak = Math.max(player.bestStreak, player.streak);
        player.score += 1;
      } else {
        player.score += 1;
      }

      return session;
    });
  }

  recordMiss(sessionId, user) {
    return this.store.updateSession(sessionId, (session) => {
      if (!session.state.players[user.id]) {
        session.state.players[user.id] = createEmptyPlayer(user);
      }

      const player = session.state.players[user.id];
      player.streak = 0;
      return session;
    });
  }

  updatePrompt(sessionId, prompt) {
    return this.store.updateSession(sessionId, (session) => {
      session.state.prompt = prompt;
      session.state.round += 1;
      return session;
    });
  }

  isExpired(session) {
    if (!session || session.status !== "active") {
      return true;
    }

    if (session.mode === "timer" && session.state.endsAt && Date.now() >= session.state.endsAt) {
      return true;
    }

    if (session.mode !== "timer" && session.state.round > session.state.rounds) {
      return true;
    }

    return false;
  }

  endSession(sessionId) {
    return this.store.endSession(sessionId);
  }

  formatLeaderboard(session) {
    const players = Object.entries(session.state.players || {})
      .map(([userId, player]) => ({ userId, ...player }))
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return right.bestStreak - left.bestStreak;
      });

    if (players.length === 0) {
      return "No players yet. Use the Join button.";
    }

    return players
      .slice(0, 8)
      .map((player, index) => {
        const streakPart = session.mode === "streak"
          ? ` | streak ${player.streak} | best ${player.bestStreak}`
          : "";
        return `${index + 1}. ${player.name}: ${player.score}${streakPart}`;
      })
      .join("\n");
  }

  buildSessionSummary(session) {
    const gameLabel = GAME_LABELS[session.game] || session.game;
    const roundLabel = session.mode === "timer"
      ? `Ends <t:${Math.floor((session.state.endsAt || Date.now()) / 1000)}:R>`
      : `Round ${Math.min(session.state.round, session.state.rounds)} / ${session.state.rounds}`;

    return {
      title: `${gameLabel} ${session.mode.toUpperCase()} Session`,
      roundLabel,
      leaderboard: this.formatLeaderboard(session),
    };
  }
}

module.exports = {
  SessionService,
};
