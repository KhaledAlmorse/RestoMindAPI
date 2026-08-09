/**
 * Redacts secret material that has no business being in a user-facing string:
 * DB connection strings, gateway API keys, AWS access key ids, bearer tokens.
 * Shared by every place that turns an internal error/model string into
 * something a client or the LLM prompt might echo back.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  return text
    .replace(/mongodb\+srv:\/\/[^\s]+/gi, '[REDACTED_DB_URL]')
    .replace(/sbg_[a-zA-Z0-9_-]+/g, '[REDACTED_API_KEY]')
    .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]');
}
