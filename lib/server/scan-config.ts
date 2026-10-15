/** Configuration is server-only. Never expose these values to a client component. */
export function scanConfiguration() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hashSecret = process.env.SCAN_HASH_SECRET;
  const configured = Boolean(
    url &&
      /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) &&
      key &&
      key.length >= 20 &&
      hashSecret &&
      hashSecret.length >= 32,
  );
  return {
    enabled: configured && process.env.SCANS_ENABLED === "true",
    configured,
  };
}

export const SCAN_RETENTION_DAYS = 30;
