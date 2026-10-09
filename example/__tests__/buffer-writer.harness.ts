import { beforeAll, describe, expect, it } from 'react-native-harness';
import {
  createBufferReader,
  createBufferWriter,
  getBufferSize,
} from 'react-native-columnar';
import {
  ROWS_SCHEMA,
  expectedRows,
  installBindings,
  readRows,
} from './helpers';

beforeAll(() => {
  installBindings();
});

describe('ColumnarBufferWriter (refill a JS-allocated buffer)', () => {
  it('fills a buffer allocated in JS with createBufferWriter', () => {
    const { buffer } = createBufferWriter(ROWS_SCHEMA, 50);
    __columnarFill(buffer, 50);
    const result = readRows(buffer);
    expect(result.header).toEqual([50, ROWS_SCHEMA.length]);
    expect(result.rows).toEqual(expectedRows(50));
  });

  it('writes fewer rows than the buffer capacity; the header holds the actual count', () => {
    const { buffer } = createBufferWriter(ROWS_SCHEMA, 1000);
    __columnarFill(buffer, 17);
    const result = readRows(buffer);
    expect(result.header[0]).toBe(17);
    expect(result.rows).toEqual(expectedRows(17));
  });

  it('reuses the same buffer across calls with changing row counts', () => {
    const { buffer } = createBufferWriter(ROWS_SCHEMA, 200);
    for (const rows of [200, 3, 150, 0, 99]) {
      __columnarFill(buffer, rows);
      expect(readRows(buffer).rows).toEqual(expectedRows(rows));
    }
  });

  it('accepts a plain new ArrayBuffer of the right size', () => {
    const buffer = new ArrayBuffer(getBufferSize(ROWS_SCHEMA, 8));
    __columnarFill(buffer, 8);
    expect(readRows(buffer).rows).toEqual(expectedRows(8));
  });

  it('throws when the buffer is too small, without writing', () => {
    const { buffer, columns } = createBufferWriter(ROWS_SCHEMA, 10);
    columns[0].fill(-1);
    expect(() => __columnarFill(buffer, 11)).toThrow(/too small/);
    expect(Array.from(createBufferReader(buffer, ROWS_SCHEMA)[1][0])).toEqual(
      new Array(10).fill(-1)
    );
  });

  it('rejects a non-ArrayBuffer argument', () => {
    const notABuffer = new Uint8Array(64) as unknown as ArrayBuffer;
    expect(() => __columnarFill(notABuffer, 1)).toThrow(/ArrayBuffer/);
  });

  it('capacity() matches the JS size calculation', () => {
    for (const byteLength of [0, 7, 8, 30, 31, 64, 65, 1000, 123_457]) {
      const capacity = __columnarCapacity(byteLength);
      if (byteLength < 8) {
        expect(capacity).toBe(0);
        continue;
      }
      expect(getBufferSize(ROWS_SCHEMA, capacity)).toBeLessThanOrEqual(
        byteLength
      );
      expect(getBufferSize(ROWS_SCHEMA, capacity + 1)).toBeGreaterThan(
        byteLength
      );
    }
  });
});
