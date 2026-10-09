import { useEffect, useState } from 'react';
import { Text, View, StyleSheet, NativeModules, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { createBufferReader, createBufferWriter, ColumnType } from 'react-native-columnar';


// JSI function types: ./globals.d.ts
type Row = BenchmarkRow;

// ============================================================
// Benchmark
// ============================================================
// Every variant returns the same data from native code. Each scenario returns a checksum,
// which is compared across variants (catches unfair or broken variants) and keeps the reads alive.

const ROW_COUNTS = [100, 500, 1000, 2000];
const ITERATIONS = 1_000;
const REPEATS = 5;
const WARMUP = 50;

const scheme = [ColumnType.Int32, ColumnType.Uint8, ColumnType.Uint8, ColumnType.Float64, ColumnType.Float64] as const

type Scenario = 'one row' | 'full scan';

const sumObject = (r: Row) => r.id + r.status + r.isActive + r.createdAt + r.updatedAt;

const readObjects = (array: Row[], rows: number, scenario: Scenario) => {
  if (scenario === 'one row') {
    return sumObject(array[rows >> 1]!);
  }
  let sum = 0;
  for (let i = 0; i < rows; i++) {
    sum += sumObject(array[i]!);
  }
  return sum;
};

const readColumns = (buffer: ArrayBuffer, rows: number, scenario: Scenario) => {
  const [, [id, status, isActive, createdAt, updatedAt]] = createBufferReader(buffer, scheme);
  const row = (i: number) => id[i]! + status[i]! + isActive[i]! + createdAt[i]! + updatedAt[i]!;
  if (scenario === 'one row') {
    return row(rows >> 1);
  }
  let sum = 0;
  for (let i = 0; i < rows; i++) {
    sum += row(i);
  }
  return sum;
};

type Variant = {
  name: string;
  prepare?: (rows: number) => void;
  run: (rows: number, scenario: Scenario) => number;
};

let reusedBuffer: ArrayBuffer | null = null;

const VARIANTS: Variant[] = [
  {
    name: 'Array of objects',
    run: (rows, scenario) => readObjects(__testArrayOfObject(rows), rows, scenario),
  },
  {
    name: 'JSON.parse',
    run: (rows, scenario) => readObjects(JSON.parse(__testJSON(rows)), rows, scenario),
  },
  {
    name: 'columnar',
    run: (rows, scenario) => readColumns(__testArrayBuffer(rows), rows, scenario),
  },
  {
    name: 'columnar, reused buffer',
    prepare: (rows) => { reusedBuffer = createBufferWriter(scheme, rows).buffer; },
    run: (rows, scenario) => {
      __testFillBuffer(reusedBuffer!, rows);
      return readColumns(reusedBuffer!, rows, scenario);
    },
  },
];

type VariantResult = { name: string; usPerCall: number; checksum: number };
type BenchmarkCase = { rows: number; scenario: Scenario; results: VariantResult[]; checksumsMatch: boolean };

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1]!;
};

const measure = (variant: Variant, rows: number, scenario: Scenario): VariantResult => {
  variant.prepare?.(rows);
  let checksum = 0;
  for (let i = 0; i < WARMUP; i++) {
    checksum = variant.run(rows, scenario);
  }
  const times: number[] = [];
  for (let r = 0; r < REPEATS; r++) {
    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      checksum = variant.run(rows, scenario);
    }
    times.push(performance.now() - start);
  }
  return { name: variant.name, usPerCall: (median(times) * 1000) / ITERATIONS, checksum };
};

const runBenchmark = (): BenchmarkCase[] => {
  const cases: BenchmarkCase[] = [];
  for (const scenario of ['one row', 'full scan'] as const) {
    for (const rows of ROW_COUNTS) {
      const results = VARIANTS.map((variant) => measure(variant, rows, scenario));
      const checksumsMatch = results.every((r) => r.checksum === results[0]!.checksum);
      cases.push({ rows, scenario, results, checksumsMatch });
      console.log(`[benchmark] ${scenario}, ${rows} rows`, results);
    }
  }
  return cases;
};

// ============================================================
// Type round-trip test
// ============================================================

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

export default function App() {

  const [running, setRunning] = useState(false)
  const [benchmark, setBenchmark] = useState<BenchmarkCase[] | null>(null)
  const [typeTestResult, setTypeTestResult] = useState<TypeTestResult | null>(null)

  useEffect(() => {
    NativeModules.JSITest.install()
  }, [])

  const run = () => {
    setRunning(true)
    // Let the "Running…" label render before the synchronous benchmark blocks the JS thread.
    setTimeout(() => {
      setTypeTestResult(testAllTypes())
      setBenchmark(runBenchmark())
      setRunning(false)
    }, 50)
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <TouchableOpacity onPress={run} disabled={running}>
        <Text style={styles.button}>
          {running ? 'Running…' : 'Run benchmark'}
        </Text>
      </TouchableOpacity>
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
      {benchmark?.map(({ rows, scenario, results, checksumsMatch }) => {
        const baseline = results[0]!.usPerCall;
        return (
          <View key={`${scenario}-${rows}`} style={styles.case}>
            <Text style={styles.caseTitle}>{`${scenario} · ${rows} rows`}</Text>
            {results.map((r) => (
              <Text key={r.name} style={styles.mono}>
                {`${r.name.padEnd(24)} ${r.usPerCall.toFixed(1).padStart(8)} µs  ${(baseline / r.usPerCall).toFixed(1).padStart(6)}×`}
              </Text>
            ))}
            {!checksumsMatch && <Text style={styles.fail}>Checksums differ between variants!</Text>}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
  },
  button: {
    fontSize: 18,
    marginBottom: 16,
  },
  case: {
    alignSelf: 'stretch',
    marginTop: 12,
  },
  caseTitle: {
    fontWeight: 'bold',
    marginBottom: 4,
  },
  mono: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
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
