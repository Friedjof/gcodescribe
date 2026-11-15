export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly detail?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

/** Catch values are unknown: network errors and HTTP failures share this path. */
export function errorMessage(error: unknown, fallback = "Unknown error"): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && "message" in error
      && typeof error.message === "string" && error.message.trim()) return error.message;
  return fallback;
}

/** FastAPI uses strings for service errors and arrays for validation errors. */
export function apiDetailMessage(detail: unknown, fallback: string): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item: unknown) => {
      if (!item || typeof item !== "object" || !("msg" in item) || typeof item.msg !== "string") return [];
      const location = "loc" in item && Array.isArray(item.loc)
        ? item.loc.filter((part: unknown) => typeof part === "string" || typeof part === "number").join(".") : "";
      return [location ? `${location}: ${item.msg}` : item.msg];
    });
    if (messages.length) return messages.join("; ");
  }
  // Do not stringify arbitrary payloads: they may include submitted secrets.
  return errorMessage(detail, fallback);
}
