export interface Env {
  DB: D1Database;
  RATE_LIMITER?: RateLimit;
  RATE_LIMIT_MODE?: string;
  TURNSTILE_SECRET?: string;
}
