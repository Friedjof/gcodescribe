import { ApiError, apiDetailMessage } from "../errors";
export { ApiError } from "../errors";

const reads = new Map<string, Promise<unknown>>();
async function fail(res: Response): Promise<never> {
  let detail: unknown;
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "detail" in body) detail = body.detail;
  } catch {
    /* ignore */
  }
  throw new ApiError(apiDetailMessage(detail, res.statusText || `HTTP ${res.status}`), res.status, detail);
}

export async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const key = (!opts?.method || opts.method === "GET") && !opts?.signal ? url : null;
  if (key && reads.has(key)) return reads.get(key) as Promise<T>;
  const load = async () => {
    const res = await fetch(url, { credentials: "same-origin", ...opts });
    if (!res.ok) await fail(res);
    return res.json() as Promise<T>;
  };
  const promise = load();
  if (key) { reads.set(key, promise); void promise.finally(() => reads.delete(key)).catch(() => {}); }
  return promise;
}

/** Like {@link req} for binary endpoints (previews, originals, exports). */
export async function reqBlob(url: string, opts?: RequestInit): Promise<Blob> {
  const res = await fetch(url, { credentials: "same-origin", ...opts });
  if (!res.ok) await fail(res);
  return res.blob();
}

export async function reqArrayBuffer(url: string, opts?: RequestInit): Promise<ArrayBuffer> {
  const res = await fetch(url, { credentials: "same-origin", ...opts });
  if (!res.ok) await fail(res);
  return res.arrayBuffer();
}
