type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null ? value as UnknownRecord : null;
}

function cleanMessage(value: unknown) {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > 240 ? `${cleaned.slice(0, 237)}...` : cleaned;
}

export function getSafeErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return cleanMessage(error.message) ?? fallback;
  const directMessage = cleanMessage(error);
  if (directMessage) return directMessage;

  const record = asRecord(error);
  if (!record) return fallback;

  const code = typeof record.code === "number" || typeof record.code === "string"
    ? String(record.code)
    : null;
  const message = cleanMessage(record.message);
  const body = asRecord(record.body);
  const bodyMessage = cleanMessage(record.body)
    ?? cleanMessage(body?.retMsg)
    ?? cleanMessage(body?.message)
    ?? cleanMessage(body?.error);

  const status = code ? `HTTP ${code}` : null;
  const details = [status, message, bodyMessage]
    .filter((part, index, parts): part is string => Boolean(part) && parts.indexOf(part) === index);
  return details.length ? details.join(": ") : fallback;
}
