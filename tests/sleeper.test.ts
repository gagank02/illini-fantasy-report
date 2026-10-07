import { afterEach, expect, test, vi } from 'vitest';
import { createLimiter } from '../src/lib/sleeper';

afterEach(() => vi.useRealTimers());

test('allows up to max calls per window, then waits for the oldest to expire', async () => {
  vi.useFakeTimers();
  const limit = createLimiter(2, 60_000);
  const done: number[] = [];
  for (const i of [1, 2, 3]) void limit().then(() => done.push(i));
  await vi.advanceTimersByTimeAsync(0);
  expect(done).toEqual([1, 2]);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(done).toEqual([1, 2]);
  await vi.advanceTimersByTimeAsync(1);
  expect(done).toEqual([1, 2, 3]);
});
