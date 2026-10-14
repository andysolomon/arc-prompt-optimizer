/** Run ids are UUIDs; the pattern is shared with client code, which must not import the server-only store. */
export const RUN_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/u;

export function isRunId(value: string | null): value is string {
  return value !== null && RUN_ID_PATTERN.test(value);
}
