const HEADER_SIZE = 2; // number of Int32 elements in header: [rows, columns]
const DATA_ALIGNMENT = 8;

export enum ColumnType {
  Int8 = 1,
  Uint8 = 2,   // use for bool / flags
  Int16 = 3,
  Uint16 = 4,
  Int32 = 5,   // use for integers (id, count, enum…)
  Uint32 = 6,
  Float32 = 7, // use for low-precision decimals (ratio, normalized value, screen coord…)
  Float64 = 8, // use for timestamps (ms), prices, high-precision decimals
}

type ColumnArray<T extends ColumnType> =
  T extends ColumnType.Int8 ? Int8Array :
  T extends ColumnType.Uint8 ? Uint8Array :
  T extends ColumnType.Int16 ? Int16Array :
  T extends ColumnType.Uint16 ? Uint16Array :
  T extends ColumnType.Int32 ? Int32Array :
  T extends ColumnType.Uint32 ? Uint32Array :
  T extends ColumnType.Float32 ? Float32Array :
  T extends ColumnType.Float64 ? Float64Array :
  never;

type ColumnsResult<TSchema extends readonly ColumnType[]> = {
  [K in keyof TSchema]: ColumnArray<TSchema[K]>;
};

const TYPE_SIZE = {
  [ColumnType.Int8]: 1,
  [ColumnType.Uint8]: 1,
  [ColumnType.Int16]: 2,
  [ColumnType.Uint16]: 2,
  [ColumnType.Int32]: 4,
  [ColumnType.Uint32]: 4,
  [ColumnType.Float32]: 4,
  [ColumnType.Float64]: 8,
} as const;

const TYPE_ALIGN = {
  [ColumnType.Int8]: 1,
  [ColumnType.Uint8]: 1,
  [ColumnType.Int16]: 2,
  [ColumnType.Uint16]: 2,
  [ColumnType.Int32]: 4,
  [ColumnType.Uint32]: 4,
  [ColumnType.Float32]: 4,
  [ColumnType.Float64]: 8,
} as const;

function alignTo(value: number, alignment: number) {
  return value + ((alignment - (value % alignment)) % alignment);
}

export function createBufferReader<
  const TSchema extends readonly ColumnType[]
>(
  buffer: ArrayBuffer,
  schema: TSchema
): [Int32Array<ArrayBuffer>, ColumnsResult<TSchema>] {

  const header = new Int32Array(buffer, 0, HEADER_SIZE);

  const rows = header[0]!;

  let offset = alignTo(HEADER_SIZE * Int32Array.BYTES_PER_ELEMENT, DATA_ALIGNMENT);

  const result = schema.map((type) => {
    offset = alignTo(offset, TYPE_ALIGN[type]);
    let arr;
    switch (type) {
      case ColumnType.Int8:    arr = new Int8Array(buffer, offset, rows);    break;
      case ColumnType.Uint8:   arr = new Uint8Array(buffer, offset, rows);   break;
      case ColumnType.Int16:   arr = new Int16Array(buffer, offset, rows);   break;
      case ColumnType.Uint16:  arr = new Uint16Array(buffer, offset, rows);  break;
      case ColumnType.Int32:   arr = new Int32Array(buffer, offset, rows);   break;
      case ColumnType.Uint32:  arr = new Uint32Array(buffer, offset, rows);  break;
      case ColumnType.Float32: arr = new Float32Array(buffer, offset, rows); break;
      case ColumnType.Float64: arr = new Float64Array(buffer, offset, rows); break;
      default: throw new Error(`Unsupported column type: ${type}`);
    }
    offset += rows * TYPE_SIZE[type];
    return arr;
  });

  return [
    header,
    result as ColumnsResult<TSchema>,
  ] as const;
}
