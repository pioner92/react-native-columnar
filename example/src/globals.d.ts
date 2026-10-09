// JSI functions installed by example/ios/JSITest.mm (NativeModules.JSITest.install()).

type BenchmarkRow = {
  id: number;
  status: number;
  isActive: number;
  createdAt: number;
  updatedAt: number;
};

declare function __testArrayOfObject(rows: number): Array<BenchmarkRow>;
declare function __testJSON(rows: number): string;
declare function __testArrayBuffer(rows: number): ArrayBuffer;
declare function __testFillBuffer(buffer: ArrayBuffer, rows: number): void;
declare function __testAllTypes(): ArrayBuffer;

// Test-only bindings (installTestBindings), used by example/__tests__.
declare function __columnarRows(
  rows: number,
  uninitialized?: boolean
): ArrayBuffer;
declare function __columnarResize(
  initialRows: number,
  finalRows: number,
  uninitialized?: boolean
): ArrayBuffer;
declare function __columnarGrow(
  rows: number,
  uninitialized?: boolean
): ArrayBuffer;
declare function __columnarAllTypes(rows: number): ArrayBuffer;
declare function __columnarUseAfterRelease(action: string): void;
declare function __columnarFill(buffer: ArrayBuffer, rows: number): void;
declare function __columnarCapacity(byteLength: number): number;
declare function __columnarBufferSize(rows: number): number;
declare function __columnarAsync(
  rows: number,
  fail?: boolean
): Promise<ArrayBuffer>;
