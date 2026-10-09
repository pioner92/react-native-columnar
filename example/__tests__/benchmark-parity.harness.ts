import { beforeAll, describe, expect, it } from 'react-native-harness';
import {
  ColumnType,
  createBufferReader,
  createBufferWriter,
} from 'react-native-columnar';
import { installBindings } from './helpers';

const BENCH_SCHEMA = [
  ColumnType.Int32,
  ColumnType.Uint8,
  ColumnType.Uint8,
  ColumnType.Float64,
  ColumnType.Float64,
] as const;

type Row = {
  id: number;
  status: number;
  isActive: number;
  createdAt: number;
  updatedAt: number;
};

const fromColumns = (buffer: ArrayBuffer): Row[] => {
  const [header, [id, status, isActive, createdAt, updatedAt]] =
    createBufferReader(buffer, BENCH_SCHEMA);
  return Array.from({ length: header[0]! }, (_, i) => ({
    id: id[i]!,
    status: status[i]!,
    isActive: isActive[i]!,
    createdAt: createdAt[i]!,
    updatedAt: updatedAt[i]!,
  }));
};

beforeAll(() => {
  installBindings();
});

// The benchmark is only fair if every variant transports exactly the same data.
describe('benchmark variants return identical data', () => {
  for (const rows of [0, 1, 100, 2000]) {
    it(`${rows} rows`, () => {
      const objects = __testArrayOfObject(rows).map((r) => ({ ...r }));
      const json = JSON.parse(__testJSON(rows)) as Row[];
      const columnar = fromColumns(__testArrayBuffer(rows));
      const { buffer } = createBufferWriter(BENCH_SCHEMA, rows);
      __testFillBuffer(buffer, rows);
      const reused = fromColumns(buffer);

      expect(objects.length).toBe(rows);
      expect(json).toEqual(objects);
      expect(columnar).toEqual(objects);
      expect(reused).toEqual(objects);
    });
  }

  it('objects use the camelCase keys the JS side reads', () => {
    expect(Object.keys(__testArrayOfObject(1)[0]!).sort()).toEqual([
      'createdAt',
      'id',
      'isActive',
      'status',
      'updatedAt',
    ]);
  });
});
