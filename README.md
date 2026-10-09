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

RN_COLUMNAR_DECLARE_SCHEMA(UserSchema, USER_COLUMNS)
```

Generates `UserSchema` with `columnCount`, `byteSize()`, and a `Columns` struct of `std::span` views. (`DECLARE_BINARY_SCHEMA` still works as an alias.)

Only types from the [mapping table](#columntype-mapping) are accepted — anything else (`bool`, `int64_t`, `char`, `long`, …) fails at compile time with a `static_assert` naming the column. Use `uint8_t` for booleans.

### 2. Write and return an ArrayBuffer

```cpp
using namespace rn_columnar;

jsi::Value getUsers(jsi::Runtime& rt, const jsi::Value*, const jsi::Value* args, size_t) {
  const uint32_t rows = static_cast<uint32_t>(args[0].asNumber());

  ColumnarWriter<UserSchema> writer(rows);
  auto& cols = writer.columns();

  for (uint32_t i = 0; i < rows; ++i) {
    cols.id[i]        = dbRow[i].id;
    cols.status[i]    = dbRow[i].status;
    cols.isActive[i]  = dbRow[i].isActive;
    cols.createdAt[i] = dbRow[i].createdAt;
    cols.updatedAt[i] = dbRow[i].updatedAt;
  }

  return std::move(writer).toArrayBuffer(rt); // zero-copy move into JSI
}
```

`toArrayBuffer()` must be called on an rvalue (`std::move(writer)`): ownership of the memory passes to JS, and the explicit move makes that hand-off visible (and lets `clang-tidy`'s `bugprone-use-after-move` catch later use of the writer).

(`ColumnarWriterBuilder` is still available as an alias of `ColumnarWriter`.)

### 3. Unknown row count (e.g. SQLite)

When the number of rows isn't known up front, start with a guess, grow with `resize()` while filling, and trim to the real count at the end. Existing rows are kept, new rows are zero-filled:

```cpp
ColumnarWriter<UserSchema> writer(256);
auto& cols = writer.columns(); // reference stays valid across resize()

uint32_t n = 0;
while (sqlite3_step(stmt) == SQLITE_ROW) {
  if (n == writer.rows()) {
    writer.resize(writer.rows() * 2);
  }
  cols.id[n]        = sqlite3_column_int(stmt, 0);
  cols.createdAt[n] = sqlite3_column_double(stmt, 1);
  // ...
  ++n;
}

writer.resize(n); // trim: compacts columns in place
return std::move(writer).toArrayBuffer(rt);
```

### 4. Skipping the zero-fill

By default the buffer is zeroed on allocation. If you write every cell anyway, skip that pass:

```cpp
ColumnarWriter<UserSchema> writer(rows, Init::Uninitialized);
```

Unwritten cells (and rows added by `resize()`) then contain garbage, so use it only when the loop covers every row of every column. It matters for large buffers (hundreds of thousands of rows); for small ones the difference is negligible.

### 5. Filling on a background thread

`ColumnarWriter` doesn't touch the JS runtime until `toArrayBuffer()`, so the heavy part (a DB query, frame processing) can run on any thread. Only `toArrayBuffer()` and anything involving `jsi::Value` must run on the JS thread. A Promise-based host function using `CallInvoker`:

```cpp
#include <ReactCommon/CallInvoker.h>

jsi::Function makeGetUsersAsync(jsi::Runtime& rt, std::shared_ptr<react::CallInvoker> jsInvoker) {
  return jsi::Function::createFromHostFunction(
      rt, jsi::PropNameID::forAscii(rt, "getUsersAsync"), 0,
      [jsInvoker](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
        auto executor = jsi::Function::createFromHostFunction(
            rt, jsi::PropNameID::forAscii(rt, "executor"), 2,
            [jsInvoker](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t) -> jsi::Value {
              // jsi::Value may only be touched on the JS thread: the worker just carries these pointers along.
              auto resolve = std::make_shared<jsi::Value>(rt, args[0]);
              auto reject = std::make_shared<jsi::Value>(rt, args[1]);

              std::thread([jsInvoker, resolve = std::move(resolve), reject = std::move(reject)]() mutable {
                // Background thread: no jsi calls here, the writer needs no runtime.
                std::shared_ptr<ColumnarWriter<UserSchema>> writer;
                std::string error;
                try {
                  const auto rows = queryUsers();
                  writer = std::make_shared<ColumnarWriter<UserSchema>>(
                      static_cast<uint32_t>(rows.size()), Init::Uninitialized);
                  auto& cols = writer->columns();
                  for (size_t i = 0; i < rows.size(); ++i) {
                    cols.id[i] = rows[i].id;
                    cols.createdAt[i] = rows[i].createdAt;
                  }
                } catch (const std::exception& e) {
                  error = e.what();
                }

                // Moving resolve/reject into the JS-thread task makes sure they are destroyed there.
                jsInvoker->invokeAsync([writer = std::move(writer), error = std::move(error),
                                        resolve = std::move(resolve), reject = std::move(reject)](jsi::Runtime& rt) {
                  if (writer) {
                    resolve->asObject(rt).asFunction(rt).call(rt, std::move(*writer).toArrayBuffer(rt));
                  } else {
                    auto jsError = rt.global().getPropertyAsFunction(rt, "Error")
                                       .callAsConstructor(rt, jsi::String::createFromUtf8(rt, error));
                    reject->asObject(rt).asFunction(rt).call(rt, jsError);
                  }
                });
              }).detach();
              return jsi::Value::undefined();
            });
        return rt.global().getPropertyAsFunction(rt, "Promise").callAsConstructor(rt, std::move(executor));
      });
}
```

The `jsInvoker` comes from your TurboModule (`jsInvoker_`) or from `RCTCxxBridge.jsCallInvoker` / `CatalystInstance.getJSCallInvokerHolder()` in legacy modules. In production, prefer a thread pool or a serial queue over `std::thread` per call.

### 6. Reusing a buffer (streams, frames)

For high-frequency data (sensors, frame processors) allocating a new buffer per call creates GC pressure. Instead, allocate once in JS and let native code refill it in place with `ColumnarBufferWriter`:

```cpp
// JS calls: __fillFrame(buffer, rows)
jsi::Value fillFrame(jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t) {
  const auto buffer = args[0].asObject(rt).getArrayBuffer(rt);
  const auto rows = static_cast<uint32_t>(args[1].asNumber());

  ColumnarBufferWriter<PointSchema> writer(rt, buffer, rows); // throws if the buffer is too small
  auto& cols = writer.columns();
  for (uint32_t i = 0; i < rows; ++i) {
    cols.x[i] = points[i].x;
    cols.y[i] = points[i].y;
  }
  return jsi::Value::undefined();
}
```

```ts
const { buffer } = createBufferWriter(POINT_SCHEMA, MAX_POINTS); // allocated once

function onFrame(rows: number) {
  __fillFrame(buffer, rows);
  const [, [x, y]] = createBufferReader(buffer, POINT_SCHEMA); // re-read: row count may change
  // ...
}
```

- The buffer may be larger than needed: the header stores the actual row count, and `ColumnarBufferWriter<S>::capacity(byteLength)` tells how many rows fit.
- Old bytes are not cleared — write every cell.
- Use it on the JS thread only. If JS may still be reading the previous frame (e.g. it is passed to an animation), alternate between two buffers.

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

createBufferWriter(schema: readonly ColumnType[], rows: number)
  // → { buffer: ArrayBuffer, columns: TypedArray[] }  (writable views, same layout as C++)

getBufferSize(schema: readonly ColumnType[], rows: number)
  // → total ArrayBuffer size in bytes, header included
```

### Mocking native modules in tests

`createBufferWriter` builds a buffer byte-for-byte identical to what `ColumnarWriter` produces, so Jest tests can run without native code:

```ts
jest.mock('./native', () => ({
  getUsers: () => {
    const { buffer, columns } = createBufferWriter(USER_SCHEMA, 2);
    const [id, status, isActive, createdAt, updatedAt] = columns;
    id.set([1, 2]);
    status.set([0, 1]);
    isActive.set([1, 1]);
    createdAt.set([1710000000000, 1710000000500]);
    updatedAt.set([1710000001000, 1710000001500]);
    return buffer;
  },
}));
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

## 🗂 Memory management

**Buffer ownership**

`ColumnarWriter` allocates a `std::vector<uint8_t>` internally. Calling `std::move(writer).toArrayBuffer(rt)` moves the vector into a `shared_ptr<VectorBuffer>` (a `jsi::MutableBuffer` subclass) and hands it to the JSI runtime. After this call the writer is released: `columns()`, `resize()` and a second `toArrayBuffer()` throw `std::logic_error`, and the spans held by the writer are reset to empty.

**Lifetime on the JS side**

The JS runtime (Hermes / V8) becomes the sole owner of the `ArrayBuffer`. All typed-array views returned by `createBufferReader` are zero-copy views over the same memory — each view holds an implicit reference to the `ArrayBuffer`.

The underlying `std::vector` is freed when **all** JS references are gone: the original `ArrayBuffer` object and every typed-array view derived from it. No explicit `free()` or reference counting is required.

```
ColumnarWriter         →  toArrayBuffer()  →  shared_ptr<VectorBuffer>
                                                       ↑
                              jsi::ArrayBuffer  ───────┘   (JSI runtime owns)
                                    ↑
                Int32Array / Float64Array / …            (views, no copy)

All JS refs dropped  →  GC  →  shared_ptr ref-count = 0  →  vector freed
```

**Practical rules**

- Don't keep a typed-array view alive longer than needed — it pins the entire buffer in memory.
- Take columns by reference (`auto& cols = writer.columns()`) and don't write to them after `toArrayBuffer()` — the memory now belongs to JS and may already be freed. A copy (`auto cols = ...`) keeps raw spans that the writer cannot reset.
- `toArrayBuffer()` can be called only once per writer.
- `resize()` re-lays out the buffer: an `auto&` reference from `columns()` stays valid, raw `std::span` copies and pointers taken before it do not. Growing copies the data (O(size)), so grow geometrically (×2), not row by row.

---

## ⚠️ Limitations

Designed for dense numeric data only. Strings, nullable values, nested objects, and variable-length fields are not supported natively — encode them as fixed-width columns using ids, offsets, or sentinel values.

---

## 🛠 Troubleshooting

**`react-native-columnar.h` not found on Android** — check that `prefab true` is enabled and CMake links the package correctly.

**`std::span` errors** — set C++20 on the target that includes the header.

**`static_assert`: column '…' has unsupported type** — the column uses a C++ type with no JS counterpart. Switch it to one of the types in the mapping table (e.g. `bool` → `uint8_t`).

**`RangeError` in JS** — JS and C++ schemas are out of sync. Check column order and types match exactly (`int32_t` → `Int32`, `double` → `Float64`).

**Values look shifted** — one wrong type shifts all following columns. Compare schemas line by line.

---

## Contributing

- [Development workflow](CONTRIBUTING.md#development-workflow)
- [Sending a pull request](CONTRIBUTING.md#sending-a-pull-request)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

MIT
