import { beforeAll, describe, expect, it } from 'react-native-harness';
import { getBufferSize } from 'react-native-columnar';
import {
  ROWS_SCHEMA,
  ZERO_ROW,
  expectedRows,
  installBindings,
  readRows,
} from './helpers';

beforeAll(() => {
  installBindings();
});

describe('ColumnarWriter.resize', () => {
  const cases: Array<[from: number, to: number]> = [
    [100, 37], // shrink
    [100, 1],
    [100, 0], // shrink to empty
    [5, 300], // grow
    [0, 10], // grow from empty
    [64, 64], // no-op
    [3, 4], // grow by one row (alignment edge)
    [4, 3], // shrink by one row
  ];

  for (const [from, to] of cases) {
    it(`${from} → ${to} rows keeps data and layout`, () => {
      const buffer = __columnarResize(from, to);
      const result = readRows(buffer);
      const kept = Math.min(from, to);

      expect(result.header).toEqual([to, ROWS_SCHEMA.length]);
      expect(buffer.byteLength).toBe(getBufferSize(ROWS_SCHEMA, to));
      expect(result.rows.slice(0, kept)).toEqual(expectedRows(kept));
      // Rows added by a grow are zero-filled in the default mode.
      expect(result.rows.slice(kept)).toEqual(
        Array.from({ length: to - kept }, () => ZERO_ROW)
      );
    });
  }

  it('keeps written rows in Init::Uninitialized mode', () => {
    expect(readRows(__columnarResize(50, 20, true)).rows).toEqual(
      expectedRows(20)
    );
    expect(readRows(__columnarResize(20, 80, true)).rows.slice(0, 20)).toEqual(
      expectedRows(20)
    );
  });

  for (const rows of [0, 1, 2, 3, 1000, 4097]) {
    it(`fills ${rows} rows with an unknown count (grow ×2, then trim)`, () => {
      const result = readRows(__columnarGrow(rows));
      expect(result.header).toEqual([rows, ROWS_SCHEMA.length]);
      expect(result.rows).toEqual(expectedRows(rows));
      expect(readRows(__columnarGrow(rows, true)).rows).toEqual(
        expectedRows(rows)
      );
    });
  }
});
