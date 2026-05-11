# react-native-columnar

A utility for high-performance data transport from JSI C++ to JavaScript.

JSI native modules typically return data as an array of objects — one JS object per row, with a key for every field. This works fine for small amounts of data, but becomes slow at scale: the JS engine has to allocate thousands of objects, box every value, and put pressure on the GC.

`react-native-columnar` replaces the array of objects with a single binary `ArrayBuffer` in columnar layout. The C++ side writes all values directly into a pre-allocated buffer, passes it to JS via JSI with zero copies, and the JS side reads it through typed array views (`Int32Array`, `Float64Array`, etc.) over the same memory — no allocation, no parsing, no overhead.

---

## Installation

```sh
npm install react-native-columnar
# or
yarn add react-native-columnar
```

**iOS** — headers are picked up automatically via CocoaPods.

**Android** — add to your library's `CMakeLists.txt`:

```cmake
set(NODE_MODULES_DIR "${CMAKE_SOURCE_DIR}/../../../node_modules")

add_subdirectory(
  ${NODE_MODULES_DIR}/react-native-columnar/android
  ${CMAKE_BINARY_DIR}/react-native-columnar
)

target_link_libraries(${YOUR_LIBRARY_NAME} react-native-columnar)
```

---

## How it works

```
C++ (JSI)                          JavaScript
──────────────────────────────     ──────────────────────────────
ColumnarWriterBuilder               createBufferReader()
  → allocates buffer                → wraps buffer with typed views
  → writes columns (int32/          → Int32Array / Float64Array /
    double / uint8) by value          Uint8Array pointing into the
  → zero-copy ArrayBuffer             same memory — no copy
    transfer via JSI
```

The binary layout:

```
[ rows: u32 | columns: u32 ][ col0 data ][ padding ][ col1 data ] ...
  ──── 8-byte header ────   ──────────── data, 8-byte aligned ───────
```

---

## C++ side

### 1. Define a schema

Use `DECLARE_BINARY_SCHEMA` to declare a schema. The second argument is an X-macro that lists `(CppType, fieldName)` pairs:

```cpp
#include "react-native-columnar.h"

#define USER_COLUMNS(X)       \
  X(int32_t, id)              \
  X(uint8_t, status)          \
  X(uint8_t, isActive)        \
  X(double,  createdAt)       \
  X(double,  updatedAt)

DECLARE_BINARY_SCHEMA(UserSchema, USER_COLUMNS)
```

This generates a `UserSchema` struct with `columnCount`, `byteSize()`, and a `Columns` struct holding `std::span` views for each field.

### 2. Write data and return an ArrayBuffer

```cpp
#include "react-native-columnar.h"

jsi::Value getUsers(jsi::Runtime& rt, const jsi::Value*, const jsi::Value* args, size_t) {
  const uint32_t rows = static_cast<uint32_t>(args[0].asNumber());

  rn_columnar::ColumnarWriterBuilder<UserSchema> writer(rows);
  auto cols = UserSchema::createColumns(writer);

  for (uint32_t i = 0; i < rows; ++i) {
    cols.id[i]        = getUser(i).id;
    cols.status[i]    = getUser(i).status;
    cols.isActive[i]  = getUser(i).isActive;
    cols.createdAt[i] = getUser(i).createdAt;
    cols.updatedAt[i] = getUser(i).updatedAt;
  }

  return writer.toArrayBuffer(rt);
}
```

`toArrayBuffer` moves the buffer into a JSI `ArrayBuffer` — **no copy**.

---

## JS side

### Read the buffer

Define the schema once — it must match the column order and types declared in C++:

```ts
import { createBufferReader, ColumnType } from 'react-native-columnar';

const USER_SCHEMA = [
  ColumnType.Int32,    // id
  ColumnType.Uint8,    // status
  ColumnType.Uint8,    // isActive
  ColumnType.Float64,  // createdAt
  ColumnType.Float64,  // updatedAt
] as const;
```

Then call it on every buffer you receive from JSI:

```ts
const buffer: ArrayBuffer = __getUsers(); // your JSI function

const [header, columns] = createBufferReader(buffer, USER_SCHEMA);
const [idColumn, statusColumn, isActiveColumn, createdAtColumn, updatedAtColumn] = columns;

// Each column is a zero-copy typed array view into the original buffer:
// idColumn        — Int32Array
// statusColumn    — Uint8Array
// isActiveColumn  — Uint8Array
// createdAtColumn — Float64Array
// updatedAtColumn — Float64Array

const rowIndex = 0;
const id        = idColumn[rowIndex];
const status    = statusColumn[rowIndex];
const isActive  = isActiveColumn[rowIndex];
const createdAt = createdAtColumn[rowIndex];
const updatedAt = updatedAtColumn[rowIndex];
```

`createBufferReader` returns zero-copy typed array views — the `ArrayBuffer` is not copied.

### ColumnType mapping

| `ColumnType`           | C++ type    | JS typed array    | Bytes | Align | Tip                              |
|------------------------|-------------|-------------------|-------|-------|----------------------------------|
| `ColumnType.Int8`      | `int8_t`    | `Int8Array`       | 1     | 1     |                                  |
| `ColumnType.Uint8`     | `uint8_t`   | `Uint8Array`      | 1     | 1     | bool, flags                      |
| `ColumnType.Int16`     | `int16_t`   | `Int16Array`      | 2     | 2     |                                  |
| `ColumnType.Uint16`    | `uint16_t`  | `Uint16Array`     | 2     | 2     |                                  |
| `ColumnType.Int32`     | `int32_t`   | `Int32Array`      | 4     | 4     | integers — id, count, enum       |
| `ColumnType.Uint32`    | `uint32_t`  | `Uint32Array`     | 4     | 4     |                                  |
| `ColumnType.Float32`   | `float`     | `Float32Array`    | 4     | 4     | ratio, normalized value, screen coord (~7 sig. digits) |
| `ColumnType.Float64`   | `double`    | `Float64Array`    | 8     | 8     | timestamp (ms), price, high-precision decimals |

---

## Benchmark

**Test:** transfer 100 000 rows (5 columns) from C++ to JS and read every value.

```
Schema: id (int32) | status (uint8) | isActive (uint8) | createdAt (double) | updatedAt (double)
Rows:   100 000
```

| Approach              | Time       |
|-----------------------|------------|
| Array of objects      | ~2079.81 ms   |
| **react-native-columnar** | **~22.06 ms** |

### **94× faster**

**Array of objects** — each row is a JS object `{ id, status, isActive, createdAt, updatedAt }`. The JS engine allocates 100 000 objects with 5 keys each, boxes every value, and puts significant pressure on the GC.

**react-native-columnar** — one binary buffer is allocated in C++, all 100 000 rows are written in a single loop, and the buffer pointer is handed to the JS engine as an `ArrayBuffer`. The JS side creates five typed array views (`Int32Array`, `Uint8Array`, `Float64Array`) over the same memory — **zero copies, zero parsing, zero object allocation**.

> Measured on iPhone 16 Pro. Results will vary by device and data shape.

---

## Contributing

- [Development workflow](CONTRIBUTING.md#development-workflow)
- [Sending a pull request](CONTRIBUTING.md#sending-a-pull-request)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

MIT
