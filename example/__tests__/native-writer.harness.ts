import { beforeAll, describe, expect, it } from 'react-native-harness';
import { createBufferReader, getBufferSize } from 'react-native-columnar';
import {
  ALL_TYPES_SCHEMA,
  ROWS_SCHEMA,
  expectedAllTypes,
  expectedRows,
  installBindings,
  readRows,
} from './helpers';

beforeAll(() => {
  installBindings();
});

describe('ColumnarWriter → JS reader', () => {
  for (const rows of [0, 1, 2, 3, 7, 100, 1000, 10_000]) {
    it(`round-trips ${rows} rows (zeroed)`, () => {
      const buffer = __columnarRows(rows);
      const result = readRows(buffer);
      expect(result.header).toEqual([rows, ROWS_SCHEMA.length]);
      expect(result.rows).toEqual(expectedRows(rows));
    });

    it(`round-trips ${rows} rows (Init::Uninitialized)`, () => {
      expect(readRows(__columnarRows(rows, true)).rows).toEqual(
        expectedRows(rows)
      );
    });
  }

  it('produces a buffer of exactly getBufferSize() bytes', () => {
    for (const rows of [0, 1, 5, 333]) {
      expect(__columnarRows(rows).byteLength).toBe(
        getBufferSize(ROWS_SCHEMA, rows)
      );
      expect(__columnarBufferSize(rows)).toBe(getBufferSize(ROWS_SCHEMA, rows));
    }
  });

  it('returns typed-array views over the same ArrayBuffer (zero copy)', () => {
    const buffer = __columnarRows(10);
    const [header, columns] = createBufferReader(buffer, ROWS_SCHEMA);
    expect(header.buffer).toBe(buffer);
    for (const column of columns) {
      expect(column.buffer).toBe(buffer);
    }
    columns[0][3] = 42;
    expect(createBufferReader(buffer, ROWS_SCHEMA)[1][0][3]).toBe(42);
  });

  it('aligns every column to its element size', () => {
    const [, columns] = createBufferReader(__columnarRows(3), ROWS_SCHEMA);
    for (const column of columns) {
      expect(column.byteOffset % column.BYTES_PER_ELEMENT).toBe(0);
    }
  });

  it('keeps the buffer alive while a view is referenced', () => {
    const [, [id]] = createBufferReader(__columnarRows(1000), ROWS_SCHEMA);
    // Churn allocations so a premature free would be noticed.
    for (let i = 0; i < 200; i++) {
      __columnarRows(5000);
    }
    expect(id[999]).toBe(999 * 7 - 3);
    expect(id.length).toBe(1000);
  });
});

describe('all column types', () => {
  for (const rows of [1, 9, 64]) {
    it(`reads every type correctly over ${rows} rows`, () => {
      const [header, columns] = createBufferReader(
        __columnarAllTypes(rows),
        ALL_TYPES_SCHEMA
      );
      expect(Array.from(header)).toEqual([rows, ALL_TYPES_SCHEMA.length]);
      expect(columns.map((c) => c.constructor.name)).toEqual([
        'Int8Array',
        'Uint8Array',
        'Int16Array',
        'Uint16Array',
        'Int32Array',
        'Uint32Array',
        'Float32Array',
        'Float64Array',
      ]);
      for (let i = 0; i < rows; i++) {
        expect(columns.map((c) => c[i])).toEqual(expectedAllTypes(i));
      }
    });
  }

  it('keeps the legacy __testAllTypes buffer readable', () => {
    const [header, columns] = createBufferReader(
      __testAllTypes(),
      ALL_TYPES_SCHEMA
    );
    expect(Array.from(header)).toEqual([10, 8]);
    expect(columns.map((c) => c[9])).toEqual([
      -5, 250, -1000, 65000, -100000, 3000000000, 1.5, 1234567890,
    ]);
  });
});
