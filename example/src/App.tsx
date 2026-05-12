import { useEffect, useState } from 'react';
import { Text, View, StyleSheet, NativeModules, TouchableOpacity } from 'react-native';
import { createBufferReader, ColumnType } from 'react-native-columnar';


type Row = {
  id: number;
  status: boolean;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

declare global {
  function __testArrayOfObject(): Array<Row>
  function __testArrayBuffer(): ArrayBuffer;
  function __testAllTypes(): ArrayBuffer;
}

const ITERATIONS = 10_000;

const testArrayOfObject = () => {
  const start = performance.now()

  for (let i = 0; i < ITERATIONS; i++) {


    const array = __testArrayOfObject()

    const rowIndex = 5;

    // @ts-ignore
    const { id, status, isActive, createdAt, updatedAt } = array[rowIndex]
  }

  return performance.now() - start
}

const scheme = [ColumnType.Int32, ColumnType.Uint8, ColumnType.Uint8, ColumnType.Float64, ColumnType.Float64] as const

const testArrayBuffer = () => {
  const start = performance.now()

  for (let i = 0; i < ITERATIONS; i++) {
    const buffer = __testArrayBuffer()

    const [header, columns] = createBufferReader(buffer, scheme)
    const [idColumn, statusColumn, isActiveColumn, createdAtColumn, updatedAtColumn] = columns

    const rowIndex = 5;

    const id = idColumn[rowIndex]
    const status = statusColumn[rowIndex]
    const isActive = isActiveColumn[rowIndex]
    const createdAt = createdAtColumn[rowIndex]
    const updatedAt = updatedAtColumn[rowIndex]
  }

  return performance.now() - start
}

const ALL_TYPES_ROWS = 10;

const allTypesScheme = [
  ColumnType.Int8,
  ColumnType.Uint8,
  ColumnType.Int16,
  ColumnType.Uint16,
  ColumnType.Int32,
  ColumnType.Uint32,
  ColumnType.Float32,
  ColumnType.Float64,
] as const;

const EXPECTED = {
  rows: ALL_TYPES_ROWS,
  columns: 8,
  int8: -5,
  uint8: 250,
  int16: -1000,
  uint16: 65000,
  int32: -100000,
  uint32: 3000000000,
  float32: 1.5,
  float64: 1234567890.0,
} as const;

type CheckResult = { pass: true; label: string } | { pass: false; label: string; reason: string };

const check = (label: string, actual: unknown, expected: unknown): CheckResult => {
  if (actual === expected) return { pass: true, label };
  return { pass: false, label, reason: `expected ${expected}, got ${actual}` };
};

const checkType = (label: string, value: unknown, ctor: abstract new (...args: any[]) => any): CheckResult => {
  if (value instanceof ctor) return { pass: true, label };
  return { pass: false, label, reason: `expected ${ctor.name}` };
};

type TypeTestResult = { passed: number; failed: number; errors: string[] };

const testAllTypes = (): TypeTestResult => {
  const buffer = __testAllTypes();
  const [header, columns] = createBufferReader(buffer, allTypesScheme);
  const [int8Col, uint8Col, int16Col, uint16Col, int32Col, uint32Col, float32Col, float64Col] = columns;

  const checks: CheckResult[] = [
    check('header[0] (rows)',    header[0], EXPECTED.rows),
    check('header[1] (columns)', header[1], EXPECTED.columns),
    checkType('Int8Array',    int8Col,    Int8Array),
    checkType('Uint8Array',   uint8Col,   Uint8Array),
    checkType('Int16Array',   int16Col,   Int16Array),
    checkType('Uint16Array',  uint16Col,  Uint16Array),
    checkType('Int32Array',   int32Col,   Int32Array),
    checkType('Uint32Array',  uint32Col,  Uint32Array),
    checkType('Float32Array', float32Col, Float32Array),
    checkType('Float64Array', float64Col, Float64Array),
    check('int8Col.length',    int8Col.length,    EXPECTED.rows),
    check('uint8Col.length',   uint8Col.length,   EXPECTED.rows),
    check('int16Col.length',   int16Col.length,   EXPECTED.rows),
    check('uint16Col.length',  uint16Col.length,  EXPECTED.rows),
    check('int32Col.length',   int32Col.length,   EXPECTED.rows),
    check('uint32Col.length',  uint32Col.length,  EXPECTED.rows),
    check('float32Col.length', float32Col.length, EXPECTED.rows),
    check('float64Col.length', float64Col.length, EXPECTED.rows),
    check('int8[0]',    int8Col[0],    EXPECTED.int8),
    check('uint8[0]',   uint8Col[0],   EXPECTED.uint8),
    check('int16[0]',   int16Col[0],   EXPECTED.int16),
    check('uint16[0]',  uint16Col[0],  EXPECTED.uint16),
    check('int32[0]',   int32Col[0],   EXPECTED.int32),
    check('uint32[0]',  uint32Col[0],  EXPECTED.uint32),
    check('float32[0]', float32Col[0], EXPECTED.float32),
    check('float64[0]', float64Col[0], EXPECTED.float64),
  ];

  const errors = checks
    .filter((r): r is Extract<CheckResult, { pass: false }> => !r.pass)
    .map(r => `FAIL ${r.label}: ${r.reason}`);

  console.log(`[testAllTypes] ${checks.length - errors.length}/${checks.length} checks passed`);
  errors.forEach(e => console.warn(e));

  return { passed: checks.length - errors.length, failed: errors.length, errors };
};

const AVERAGE = 5;

const logData = () => {
  for (let i = 0; i < 10; i++) {
    const buffer = __testArrayBuffer()

    const [header, columns] = createBufferReader(buffer, scheme)
    const [idColumn, statusColumn, isActiveColumn, createdAtColumn, updatedAtColumn] = columns

    const id = idColumn[i]
    const status = statusColumn[i]
    const isActive = isActiveColumn[i]
    const createdAt = createdAtColumn[i]
    const updatedAt = updatedAtColumn[i]
    console.log({ header, id, status, isActive, createdAt, updatedAt })
  }
}

export default function App() {

  const [benchmarkResult, setBenchmarkResult] = useState<{
    arrayOfObject: number,
    arrayBuffer: number,
  } | null>(null)
  const [typeTestResult, setTypeTestResult] = useState<TypeTestResult | null>(null)

  useEffect(() => {
    NativeModules.JSITest.install()
  }, [])

  const run = () => {

    //warm up
    __testArrayBuffer()
    __testArrayOfObject()

    const result = {
      arrayOfObject: 0,
      arrayBuffer: 0,
    }


    for (let i = 0; i < AVERAGE; i++) {
      result.arrayOfObject += testArrayOfObject()
      result.arrayBuffer += testArrayBuffer()
    }
    setBenchmarkResult({
      arrayOfObject: result.arrayOfObject / AVERAGE,
      arrayBuffer: result.arrayBuffer / AVERAGE,
    })


    setTypeTestResult(testAllTypes())

    logData()

    console.log(`Average time: ArrayBuffer ${result.arrayBuffer / AVERAGE} ms`)
    console.log(`Average time: ArrayOfObject ${result.arrayOfObject / AVERAGE} ms`)
  }


  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={run}>
        <Text>
          Run benchmark
        </Text>
      </TouchableOpacity>
      {benchmarkResult && (
        <>
          <Text>
            {`react-native-columnar: ${benchmarkResult.arrayBuffer.toFixed(2)} ms`}
          </Text>
          <Text>
            {`Array of object: ${benchmarkResult.arrayOfObject.toFixed(2)} ms`}
          </Text>
          <Text>
            Faster by: {(benchmarkResult.arrayOfObject / benchmarkResult.arrayBuffer).toFixed(2)}x
          </Text>
        </>
      )}
      {typeTestResult && (
        <>
          <Text style={typeTestResult.failed === 0 ? styles.pass : styles.fail}>
            {typeTestResult.failed === 0
              ? `All types OK: ${typeTestResult.passed}/${typeTestResult.passed} checks passed`
              : `${typeTestResult.failed} check(s) FAILED`}
          </Text>
          {typeTestResult.errors.map((err, i) => (
            <Text key={i} style={styles.fail}>{err}</Text>
          ))}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  pass: {
    color: 'green',
    fontWeight: 'bold',
  },
  fail: {
    color: 'red',
    fontWeight: 'bold',
  },
});
