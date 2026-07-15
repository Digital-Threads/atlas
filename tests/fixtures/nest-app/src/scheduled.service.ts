import { Injectable } from "@nestjs/common";
import { Cron, CronExpression, Interval } from "@nestjs/schedule";

@Injectable()
export class ScheduledService {
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: "UTC" })
  rebuildDailyStats() {
    return true;
  }

  @Interval(60_000)
  refreshRuntimeCache() {
    return true;
  }
}

