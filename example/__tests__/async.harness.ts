import { beforeAll, describe, expect, it } from 'react-native-harness';
import { expectedRows, installBindings, readRows } from './helpers';

beforeAll(() => {
  installBindings();
});

describe('filling on a background thread (CallInvoker + Promise)', () => {
  it('resolves with a buffer filled off the JS thread', async () => {
    const buffer = await __columnarAsync(500);
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(readRows(buffer).rows).toEqual(expectedRows(500));
  });

  it('resolves an empty buffer', async () => {
    expect(readRows(await __columnarAsync(0)).rows).toEqual([]);
  });

  it('rejects with an Error when the worker fails', async () => {
    await expect(__columnarAsync(10, true)).rejects.toThrow(
      'requested failure'
    );
    await __columnarAsync(10, true).catch((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
    });
  });

  it('handles many concurrent requests', async () => {
    const sizes = Array.from({ length: 32 }, (_, i) => i * 37);
    const buffers = await Promise.all(
      sizes.map((rows) => __columnarAsync(rows))
    );
    buffers.forEach((buffer, i) => {
      expect(readRows(buffer).rows).toEqual(expectedRows(sizes[i]!));
    });
  });

  it('returns control to JS before the buffer is ready', async () => {
    let settled = false;
    const pending = __columnarAsync(200_000).then((buffer) => {
      settled = true;
      return buffer;
    });
    // The host function only schedules work; resolution always comes later via the CallInvoker.
    expect(settled).toBe(false);
    expect(readRows(await pending).rows.length).toBe(200_000);
  });
});
