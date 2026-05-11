<img src="./assets/img.webp" alt="react-native-columnar" />

# react-native-columnar

[![npm](https://img.shields.io/npm/v/react-native-columnar)](https://www.npmjs.com/package/react-native-columnar)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![platform](https://img.shields.io/badge/platform-iOS%20%7C%20Android-lightgrey)]()

Zero-copy columnar `ArrayBuffer` transport from JSI C++ to JavaScript.

JSI modules often return datasets as arrays of objects — every row becomes a JS object, every value gets boxed, GC pressure grows. `react-native-columnar` packs all values into one binary buffer and exposes each column as a typed array view over the same memory. No objects, no parsing, no copy.

---

## ⚡ Benchmark

10 000 iterations · 5 columns · iPhone 16 Pro

```
id (int32) | status (uint8) | isActive (uint8) | createdAt (double) | updatedAt (double)
```

| Rows | Array of objects | react-native-columnar | Speedup  |
|------|------------------|-----------------------|----------|
| 100  | ~418.81 ms       | **~14.96 ms**         | **27×**  |
| 500  | ~2079.81 ms      | **~22.06 ms**         | **94×**  |
| 1000 | ~4360.11 ms      | **~35.89 ms**         | **121×** |
| 2000 | ~9444.47 ms      | **~45.39 ms**         | **208×** |

---

## 🎯 Best use cases

SQLite result sets · Frame processor outputs · Sensor streams · Analytics events · Realtime charts · Large JSI payloads

---

## 📦 Installation

```sh
npm install react-native-columnar
# or
yarn add react-native-columnar
```

**iOS** — headers are picked up automatically via CocoaPods.

**Android — app project**

Autolinking registers the package automatically. Add to `android/app/build.gradle`:

```groovy
android {
  buildFeatures { prefab true }
}
```

Then in `CMakeLists.txt`:

```cmake
find_package(react-native-columnar REQUIRED CONFIG)
target_link_libraries(${YOUR_LIBRARY_NAME} react-native-columnar::react-native-columnar)
```

**Android — standalone library**

Add to `package.json`:

```json
{ "dependencies": { "react-native-columnar": "*" } }
```

Then in `CMakeLists.txt` (`NODE_MODULES_DIR` is already passed by any JSI library):

```cmake
include_directories(${NODE_MODULES_DIR}/react-native-columnar/cpp)
```

In your C++ files:

```cpp
#include "react-native-columnar.h"
```

---

## 🔧 C++ side

### 1. Define a schema

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

Generates `UserSchema` with `columnCount`, `byteSize()`, and a `Columns` struct of `std::span` views.

### 2. Write and return an ArrayBuffer

```cpp
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

  return writer.toArrayBuffer(rt); // zero-copy move into JSI
}
```

---

## 🟦 JS side

### 1. Define the schema

Must match column order and types from C++:

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

### 2. Read the buffer

```ts
const buffer: ArrayBuffer = __getUsers();

const [header, columns] = createBufferReader(buffer, USER_SCHEMA);
const [idCol, statusCol, isActiveCol, createdAtCol, updatedAtCol] = columns;
// idCol — Int32Array  |  statusCol — Uint8Array  |  createdAtCol — Float64Array

const id        = idCol[0];
const status    = statusCol[0];
const isActive  = isActiveCol[0];
const createdAt = createdAtCol[0];
const updatedAt = updatedAtCol[0];
```

All columns are zero-copy typed array views — the buffer is never copied.

### API

```ts
createBufferReader(buffer: ArrayBuffer, schema: readonly ColumnType[])
  // → [header: Int32Array, columns: TypedArray[]]
  // header[0] = row count, header[1] = column count
```

### ColumnType mapping

| `ColumnType`      | C++ type    | JS view        | Bytes | Tip                           |
|-------------------|-------------|----------------|-------|-------------------------------|
| `Int8`            | `int8_t`    | `Int8Array`    | 1     |                               |
| `Uint8`           | `uint8_t`   | `Uint8Array`   | 1     | bool, flags                   |
| `Int16`           | `int16_t`   | `Int16Array`   | 2     |                               |
| `Uint16`          | `uint16_t`  | `Uint16Array`  | 2     |                               |
| `Int32`           | `int32_t`   | `Int32Array`   | 4     | id, count, enum               |
| `Uint32`          | `uint32_t`  | `Uint32Array`  | 4     |                               |
| `Float32`         | `float`     | `Float32Array` | 4     | screen coords (~7 sig. digits)|
| `Float64`         | `double`    | `Float64Array` | 8     | timestamp, price              |

---

## ⚠️ Limitations

Designed for dense numeric data only. Strings, nullable values, nested objects, and variable-length fields are not supported natively — encode them as fixed-width columns using ids, offsets, or sentinel values.

---

## 🛠 Troubleshooting

**`react-native-columnar.h` not found on Android** — check that `prefab true` is enabled and CMake links the package correctly.

**`std::span` errors** — set C++20 on the target that includes the header.

**`RangeError` in JS** — JS and C++ schemas are out of sync. Check column order and types match exactly (`int32_t` → `Int32`, `double` → `Float64`).

**Values look shifted** — one wrong type shifts all following columns. Compare schemas line by line.

---

## Contributing

- [Development workflow](CONTRIBUTING.md#development-workflow)
- [Sending a pull request](CONTRIBUTING.md#sending-a-pull-request)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

MIT
