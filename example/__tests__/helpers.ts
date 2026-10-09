import { NativeModules } from 'react-native';
import { ColumnType, createBufferReader } from 'react-native-columnar';

// Global JSI function types live in example/src/globals.d.ts.

export const installBindings = () => {
  const installed = NativeModules.JSITest.install();
  if (typeof __columnarRows !== 'function') {
    throw new Error(
      `JSI test bindings were not installed (install() returned ${String(
        installed
      )})`
    );
  }
};

// Matches RowsStruct in JSITest.mm.
export const ROWS_SCHEMA = [
  ColumnType.Int32, // id
  ColumnType.Uint8, // status
  ColumnType.Uint8, // isActive
  ColumnType.Float64, // createdAt
  ColumnType.Float64, // updatedAt
] as const;

export type Row = [
  id: number,
  status: number,
  isActive: number,
  createdAt: number,
  updatedAt: number
];

// Mirrors fillRow() in JSITest.mm.
export const expectedRow = (i: number): Row => [
  i * 7 - 3,
  i % 3,
  i % 2,
  1710000000000 + i * 0.5,
  1720000000000 + i,
];

export const ZERO_ROW: Row = [0, 0, 0, 0, 0];

export const readRows = (buffer: ArrayBuffer) => {
  const [header, columns] = createBufferReader(buffer, ROWS_SCHEMA);
  const rows = header[0]!;
  const result: Row[] = [];
  for (let i = 0; i < rows; i++) {
    result.push(columns.map((column) => column[i]!) as Row);
  }
  return { header: Array.from(header), columns, rows: result };
};

export const expectedRows = (count: number, from = 0): Row[] =>
  Array.from({ length: count }, (_, i) => expectedRow(from + i));

// Matches AllTypesStruct in JSITest.mm.
export const ALL_TYPES_SCHEMA = [
  ColumnType.Int8,
  ColumnType.Uint8,
  ColumnType.Int16,
  ColumnType.Uint16,
  ColumnType.Int32,
  ColumnType.Uint32,
  ColumnType.Float32,
  ColumnType.Float64,
] as const;

// Mirrors __columnarAllTypes in JSITest.mm. `+ 0` turns -0 into 0, as typed arrays store it.
export const expectedAllTypes = (i: number) => [
  -1 - (i % 100),
  200 + (i % 50),
  -1000 * (i % 30) + 0,
  60000 + (i % 5000),
  -100000 * i + 0,
  3000000000 + i,
  Math.fround(1.5 * i),
  1234567890.25 * i,
];
