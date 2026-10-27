export function researchDetailQuery(params: URLSearchParams): Record<string, string | string[] | undefined> {
  return Object.fromEntries([...new Set(params.keys())].map((key) => {
    const values = params.getAll(key);
    return [key, values.length === 1 ? values[0] : values];
  }));
}

export const RESEARCH_DETAIL_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Cookie",
  "X-Content-Type-Options": "nosniff",
};
