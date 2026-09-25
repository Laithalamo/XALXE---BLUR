/** Talks to the Worker (relative URLs: the app lives at valve.ist/mimoza/). */
import type { Data } from './calc';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly body: Record<string, unknown>) {
    super(code);
  }
}

async function handle(res: Response) {
  let body: Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) throw new ApiError(res.status, String(body.error ?? res.status), body);
  return body;
}

export async function getData(): Promise<Data> {
  const res = await fetch('api/data', { credentials: 'same-origin', cache: 'no-store' });
  return (await handle(res)) as unknown as Data;
}

export async function post<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`api/${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-mimoza': '1' },
    body: JSON.stringify(body),
  });
  return (await handle(res)) as T;
}

export const save = (table: string, row: Record<string, unknown>) => post<{ id: string }>('save', { table, row });
export const remove = (table: string, id: string) => post('delete', { table, id });
