<img src="./assets/img.webp" alt="react-native-columnar" />

# react-native-columnar

High-performance columnar `ArrayBuffer` transport from JSI C++ to JavaScript.

JSI modules often return large datasets as arrays of objects. That is easy to use, but expensive at scale: every row becomes a JS object, every value is boxed, and the result puts pressure on the GC.

`react-native-columnar` writes fixed-width native values into one binary columnar buffer and exposes it to JS as typed array views (`Int32Array`, `Float64Array`, etc.). No per-row objects, no parsing, and no payload copy.

---

## Best use cases

- SQLite result sets
- Frame processor outputs
- Sensor streams
- Analytics events
- Game / physics data
- Large JSI payloads
- Realtime charts

---

## Benchmark

**Test:** 10 000 iterations — each call transfers N rows (5 columns) from C++ to JS and reads one row.

```
Schema: id (int32) | status (uint8) | isActive (uint8) | createdAt (double) | updatedAt (double)
Iterations: 10 000
```

| Rows | Array of objects | react-native-columnar | Speedup  |
|------|------------------|-----------------------|----------|
| 100  | ~418.81 ms       | **~14.96 ms**         | **27×**  |
| 500  | ~2079.81 ms      | **~22.06 ms**         | **94×**  |
| 1000 | ~4360.11 ms      | **~35.89 ms**         | **121×** |
| 2000 | ~9444.47 ms      | **~45.39 ms**         | **208×** |

**Array of objects** — each call allocates a JS array of objects with 5 keys each, boxes every value, and puts pressure on the GC — multiplied across 10 000 iterations.

**react-native-columnar** — one binary buffer is allocated in C++, all rows are written in a single loop, and the buffer pointer is handed to the JS engine as an `ArrayBuffer`. The JS side creates five typed array views (`Int32Array`, `Uint8Array`, `Float64Array`) over the same memory — **zero copies, zero parsing, no per-row object allocation**.

> Measured on iPhone 16 Pro. Results will vary by device and data shape.

---

## Requirements

- React Native with JSI native modules
- C++20 or newer (`std::span` is used by the C++ helper)
- iOS via CocoaPods or Android via CMake
- Fixed-width numeric data (`int8_t`, `uint32_t`, `double`, etc.)

---

## Installation

```sh
npm install react-native-columnar
# or
yarn add react-native-columnar
```

**iOS** — headers are picked up automatically via CocoaPods.

**Android — inside an app project**

Autolinking registers the package automatically. Enable Prefab in your `android/app/build.gradle`:

```groovy
android {
  buildFeatures {
    prefab true
  }
}
```

Then in your `CMakeLists.txt`:

```cmake
find_package(react-native-columnar REQUIRED CONFIG)

target_link_libraries(
  ${YOUR_LIBRARY_NAME}
  react-native-columnar::react-native-columnar
)
```

**Android — inside a standalone library**

Autolinking does not run in library projects. Use `add_subdirectory` instead — it resolves headers directly from `node_modules` without needing a Gradle dependency.

Make sure `NODE_MODULES_DIR` is passed from your `build.gradle` (any JSI library already does this):

```groovy
externalNativeBuild {
  cmake {
    arguments "-DNODE_MODULES_DIR=${nodeModules}"
  }
}
```

Then in your `CMakeLists.txt`:

```cmake
if(NOT TARGET react-native-columnar)
  add_subdirectory(
    ${NODE_MODULES_DIR}/react-native-columnar/android
    ${CMAKE_BINARY_DIR}/react-native-columnar
  )
endif()

target_link_libraries(${YOUR_LIBRARY_NAME} react-native-columnar)
```

Then in your C++ files:

```cpp
#include "react-native-columnar.h"
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

The contract is intentionally small:

- The JS schema must match the C++ schema exactly.
- Column order and type width must be the same on both sides.
- Each column stores one fixed-width primitive type.
- The buffer owns the payload; JS typed arrays are views over that same memory.

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

### Reader API

```ts
createBufferReader<TSchema extends readonly ColumnType[]>(
  buffer: ArrayBuffer,
  schema: TSchema
): [header: Int32Array, columns: ColumnsResult<TSchema>]
```

- `header[0]` — row count
- `header[1]` — column count
- `columns` — typed array views inferred from the schema order

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

## Limitations

`react-native-columnar` is optimized for dense numeric payloads. It does not encode
strings, nested objects, nullable values, or variable-length fields by itself.

For those cases, keep metadata separately or encode it into fixed-width columns
with your own conventions, such as enum ids, offsets, masks, or sentinel values.

---

## Troubleshooting

### `react-native-columnar.h` not found

Make sure the package is added to your native build and linked to your JSI library.

On Android, check that Prefab is enabled in the Gradle module that builds your
native target:

```groovy
android {
  buildFeatures {
    prefab true
  }
}
```

Then make sure CMake finds and links the Prefab package:

```cmake
find_package(react-native-columnar REQUIRED CONFIG)

target_link_libraries(
  ${YOUR_LIBRARY_NAME}
  react-native-columnar::react-native-columnar
)
```

On iOS, make sure CocoaPods has been installed after adding the package:

```sh
cd ios && pod install
```

### `std::span` is not available

The C++ helper uses `std::span`, so your native target must compile with C++20 or
newer. If your build fails with errors around `std::span`, enable C++20 for the
target that includes `react-native-columnar.h`.

### `RangeError` while creating typed arrays

This usually means the JavaScript schema does not match the native schema, or the
buffer was not created by `ColumnarWriterBuilder`.

Check that:

- The JS `ColumnType` list has the same order as the C++ schema.
- Each JS type matches the exact C++ type size (`int32_t` → `ColumnType.Int32`,
  `double` → `ColumnType.Float64`, etc.).
- The buffer is the `ArrayBuffer` returned by `writer.toArrayBuffer(rt)`.

### Values look shifted or incorrect

The reader and writer must agree on both column order and type width. A single
wrong type can shift all following columns. Start by comparing the C++ schema with
the JS schema line by line.

---

## Contributing

- [Development workflow](CONTRIBUTING.md#development-workflow)
- [Sending a pull request](CONTRIBUTING.md#sending-a-pull-request)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

MIT
