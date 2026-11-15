export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
const reads = new Map<string, Promise<unknown>>();
async function fail(res: Response): Promise<never> {
  let detail = res.statusText;
  try {
    const body = await res.json();
    detail = body.detail ?? detail;
  } catch {
    /* ignore */
  }
  throw new ApiError(detail, res.status);
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
