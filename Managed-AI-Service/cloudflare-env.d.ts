declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    OPENROUTER_API_KEY?: string;
    OPENROUTER_MODEL?: string;
    OPENROUTER_PROVIDER?: string;
    GLOBAL_DAILY_LIMIT?: string;
    DEVICE_DAILY_LIMIT?: string;
    IP_DAILY_LIMIT?: string;
    ALLOWED_ORIGINS?: string;
  }
}
