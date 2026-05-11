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
});
