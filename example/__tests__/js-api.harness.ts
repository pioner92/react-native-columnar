import { describe, expect, it } from 'react-native-harness';
import {
  ColumnType,
  createBufferReader,
  createBufferWriter,
  getBufferSize,
} from 'react-native-columnar';
import { ALL_TYPES_SCHEMA, expectedAllTypes } from './helpers';

// Pure JS API, running in the app's Hermes runtime (no native bindings needed).
describe('createBufferWriter / createBufferReader', () => {
  it('round-trips every column type', () => {
    const rows = 12;
    const { buffer, columns } = createBufferWriter(ALL_TYPES_SCHEMA, rows);
    for (let i = 0; i < rows; i++) {
      expectedAllTypes(i).forEach((value, c) => {
        columns[c]![i] = value;
      });
    }
    const [header, read] = createBufferReader(buffer, ALL_TYPES_SCHEMA);
    expect(Array.from(header)).toEqual([rows, ALL_TYPES_SCHEMA.length]);
    for (let i = 0; i < rows; i++) {
      expect(read.map((c) => c[i])).toEqual(expectedAllTypes(i));
    }
  });

  it('wraps and truncates out-of-range values like typed arrays do', () => {
    const { columns } = createBufferWriter(
      [ColumnType.Int8, ColumnType.Uint8, ColumnType.Uint32] as const,
      1
    );
    columns[0][0] = 200;
    columns[1][0] = -1;
    columns[2][0] = 2 ** 32 + 5;
    expect([columns[0][0], columns[1][0], columns[2][0]]).toEqual([
      -56, 255, 5,
    ]);
  });

  it('supports zero rows', () => {
    const { buffer, columns } = createBufferWriter(ALL_TYPES_SCHEMA, 0);
    expect(buffer.byteLength).toBe(8);
    expect(columns.every((c) => c.length === 0)).toBe(true);
    expect(createBufferReader(buffer, ALL_TYPES_SCHEMA)[0][0]).toBe(0);
  });

  it('supports an empty schema', () => {
    const { buffer, columns } = createBufferWriter([] as const, 10);
    expect(buffer.byteLength).toBe(8);
    expect(columns).toEqual([]);
  });

  it('getBufferSize matches the allocated buffer', () => {
    for (const rows of [0, 1, 2, 3, 100, 12345]) {
      expect(createBufferWriter(ALL_TYPES_SCHEMA, rows).buffer.byteLength).toBe(
        getBufferSize(ALL_TYPES_SCHEMA, rows)
      );
    }
    // 8-byte header + 26 bytes per row; padding between columns never exceeds 7 bytes per column.
    const size = getBufferSize(ALL_TYPES_SCHEMA, 1000);
    expect(size).toBeGreaterThanOrEqual(8 + 26 * 1000);
    expect(size).toBeLessThanOrEqual(
      8 + 26 * 1000 + 7 * ALL_TYPES_SCHEMA.length
    );
  });

  it('rejects invalid row counts', () => {
    for (const rows of [-1, 1.5, Number.NaN, 2 ** 32]) {
      expect(() => getBufferSize(ALL_TYPES_SCHEMA, rows)).toThrow(RangeError);
      expect(() => createBufferWriter(ALL_TYPES_SCHEMA, rows)).toThrow(
        RangeError
      );
    }
  });

  it('reads a buffer that is larger than its rows need', () => {
    const big = createBufferWriter(ALL_TYPES_SCHEMA, 100).buffer;
    const small = createBufferWriter(ALL_TYPES_SCHEMA, 3);
    small.columns[4].set([1, 2, 3]);
    new Uint8Array(big).set(new Uint8Array(small.buffer));
    const [header, columns] = createBufferReader(big, ALL_TYPES_SCHEMA);
    expect(header[0]).toBe(3);
    expect(Array.from(columns[4])).toEqual([1, 2, 3]);
  });

  it('throws RangeError when the buffer is too small for the schema', () => {
    const { buffer } = createBufferWriter([ColumnType.Uint8] as const, 4);
    expect(() =>
      createBufferReader(buffer, [ColumnType.Float64] as const)
    ).toThrow(RangeError);
  });
});
