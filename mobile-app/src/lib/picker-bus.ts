// Router-friendly picker plumbing. Sheets like /library-picker and
// /sound-picker are pushed as routes, so callers can't pass callbacks through
// navigation params. Instead the caller registers a promise under a request id
// and the sheet resolves it (or rejects on dismiss).

type Pending = { resolve: (v: any) => void };

const pending = new Map<string, Pending>();
let counter = 0;

export function createPickerRequest(): { requestId: string; promise: Promise<any> } {
  const requestId = `pick_${++counter}_${Date.now()}`;
  let resolve!: (v: any) => void;
  const promise = new Promise<any>((r) => {
    resolve = r;
  });
  pending.set(requestId, { resolve });
  return { requestId, promise };
}

// Called by the sheet. `result` is null when the user dismissed without picking.
export function resolvePickerRequest(requestId: string | undefined, result: any) {
  if (!requestId) return;
  const p = pending.get(requestId);
  if (!p) return;
  pending.delete(requestId);
  p.resolve(result);
}
