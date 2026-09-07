import type { Clock } from "@repo/rules-analysis-session";

export const systemClock: Clock = {
  now() {
    return new Date();
  },
};
