const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4003/api";
const basketApiUrl = process.env.NEXT_PUBLIC_BASKET_API_URL ?? "http://localhost:4013/api";
const defaultTimeoutMs = Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS ?? 8000);

type FetchApiOptions = {
  revalidate?: number | false;
  cache?: RequestCache;
  timeoutMs?: number;
};

export async function fetchApi<T>(path: string, options: FetchApiOptions = {}): Promise<T | null> {
  return fetchApiFromBase<T>(apiUrl, path, options);
}

export async function fetchApiFromBase<T>(baseUrl: string, path: string, options: FetchApiOptions = {}): Promise<T | null> {
  try {
    const { revalidate = 60, cache, timeoutMs = defaultTimeoutMs } = options;
    const response = await fetch(`${baseUrl}${path}`, {
      ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
      ...(cache ? { cache } : {}),
      ...(revalidate === false ? {} : { next: { revalidate } }),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export { apiUrl, basketApiUrl };