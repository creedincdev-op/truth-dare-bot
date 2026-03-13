const { DateTime } = require("luxon");

class SchedulerService {
  constructor({ client, store, promptEngine, sendPromptMessage, intervalMs = 45000 }) {
    this.client = client;
    this.store = store;
    this.promptEngine = promptEngine;
    this.sendPromptMessage = sendPromptMessage;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        console.error("Scheduler tick failed:", error);
      });
    }, this.intervalMs);
  }

  stop() {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.running || !this.client.isReady()) {
      return;
    }

    this.running = true;

    try {
      const schedules = this.store.getEnabledSchedules();

      for (const schedule of schedules) {
        const localNow = DateTime.now().setZone(schedule.timezone);
        if (!localNow.isValid) {
          continue;
        }

        const currentTime = localNow.toFormat("HH:mm");
        const localDate = localNow.toISODate();
        if (currentTime !== schedule.time || schedule.lastRunLocalDate === localDate) {
          continue;
        }

        const channel = await this.client.channels.fetch(schedule.channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
          continue;
        }

        const prompt = await this.promptEngine.getNextPrompt({
          guildId: schedule.guildId,
          channelId: schedule.channelId,
          game: schedule.game,
          category: schedule.category,
          requestedRating: schedule.rating,
          requesterTag: "Daily Drop",
        });

        await this.sendPromptMessage({
          channel,
          prompt,
          requester: { label: "Scheduled Daily Drop", avatarUrl: null },
          requesterId: null,
          guildId: schedule.guildId,
          channelId: schedule.channelId,
        });

        this.store.markScheduleRun(schedule.id, localDate);
      }
    } finally {
      this.running = false;
    }
  }
}

module.exports = {
  SchedulerService,
};
