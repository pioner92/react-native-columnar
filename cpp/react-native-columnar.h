#pragma once
#include <jsi/jsi.h>
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <memory>
#include <span>
#include <stdexcept>
#include <type_traits>
#include <utility>
#include <vector>

namespace rn_columnar {

// C++ types that have a matching ColumnType on the JS side.
template <typename T>
inline constexpr bool kIsColumnType =
    std::is_same_v<T, std::int8_t> || std::is_same_v<T, std::uint8_t> ||
    std::is_same_v<T, std::int16_t> || std::is_same_v<T, std::uint16_t> ||
    std::is_same_v<T, std::int32_t> || std::is_same_v<T, std::uint32_t> ||
    std::is_same_v<T, float> || std::is_same_v<T, double>;

struct BinaryHeader {
  std::uint32_t rows;
  std::uint32_t columns;
};
static_assert(sizeof(BinaryHeader) == 8, "BinaryHeader layout must match the JS reader");

// How a ColumnarWriter initializes its memory.
enum class Init {
  Zeroed,        // every byte starts at 0 (default)
  Uninitialized, // skips the memset; every cell must be written before handing the buffer to JS
};

namespace detail {

constexpr std::size_t alignTo(std::size_t value, std::size_t alignment) {
  return (value + alignment - 1) & ~(alignment - 1);
}

inline constexpr std::size_t kDataStart = alignTo(sizeof(BinaryHeader), 8);

// Columns are aligned to their element size, exactly like the JS reader (independent of ABI alignof).
template <std::size_t N>
constexpr std::size_t dataSize(const std::size_t (&columnSizes)[N], std::uint32_t rows) {
  std::size_t offset = 0;
  for (std::size_t size : columnSizes) {
    offset = alignTo(offset, size);
    offset += rows * size;
  }
  return offset;
}

// Lays out schema columns one after another over a raw byte range.
class ColumnCursor {
 public:
  ColumnCursor(std::uint8_t* data, std::size_t size, std::uint32_t rows)
      : data_(data), size_(size), rows_(rows) {}

  template <typename T>
  std::span<T> addColumn() {
    static_assert(kIsColumnType<T>, "rn_columnar: unsupported column type");
    offset_ = alignTo(offset_, sizeof(T));
    const std::size_t columnOffset = offset_;
    offset_ += rows_ * sizeof(T);
    if (offset_ > size_) {
      throw std::logic_error("rn_columnar: column layout exceeds buffer size");
    }
    return std::span<T>(reinterpret_cast<T*>(data_ + columnOffset), rows_);
  }

 private:
  std::uint8_t* data_;
  std::size_t size_;
  std::uint32_t rows_;
  std::size_t offset_ = kDataStart;
};

// Writes the header and returns column spans over [data, data + size).
template <typename Schema>
typename Schema::Columns layout(std::uint8_t* data, std::size_t size, std::uint32_t rows) {
  const BinaryHeader header{rows, Schema::columnCount};
  std::memcpy(data, &header, sizeof(header));
  ColumnCursor cursor(data, size, rows);
  return Schema::layoutColumns(cursor);
}

// Leaves elements uninitialized on resize(n); resize(n, value) still fills.
template <typename T>
struct DefaultInitAllocator : std::allocator<T> {
  template <typename U>
  struct rebind {
    using other = DefaultInitAllocator<U>;
  };

  using std::allocator<T>::allocator;

  template <typename U>
  void construct(U* p) noexcept(std::is_nothrow_default_constructible_v<U>) {
    ::new (static_cast<void*>(p)) U;
  }

  template <typename U, typename... Args>
  void construct(U* p, Args&&... args) {
    ::new (static_cast<void*>(p)) U(std::forward<Args>(args)...);
  }
};

} // namespace detail

using Bytes = std::vector<std::uint8_t, detail::DefaultInitAllocator<std::uint8_t>>;

#define RN_COLUMNAR_ASSERT_TYPE(type, name)                                   \
  static_assert(::rn_columnar::kIsColumnType<type>,                           \
                "rn_columnar: column '" #name "' has unsupported type '" #type \
                "'. Use int8_t, uint8_t, int16_t, uint16_t, int32_t, "         \
                "uint32_t, float or double (uint8_t for bool).");

#define RN_COLUMNAR_DECL_SPAN(type, name) std::span<type> name;

#define RN_COLUMNAR_ADD_COLUMN(type, name) .name = builder.template addColumn<type>(),

#define RN_COLUMNAR_COUNT_COL(type, name) +1

#define RN_COLUMNAR_COL_SIZE(type, name) sizeof(type),

// ============================================================
// Schema generator
// ============================================================
#define RN_COLUMNAR_DECLARE_SCHEMA(SchemaName, ColumnsMacro)        \
  struct SchemaName {                                               \
    ColumnsMacro(RN_COLUMNAR_ASSERT_TYPE)                           \
                                                                    \
    static constexpr std::uint32_t columnCount =                    \
        0 ColumnsMacro(RN_COLUMNAR_COUNT_COL);                      \
                                                                    \
    static constexpr std::size_t columnSizes[] = {                  \
      ColumnsMacro(RN_COLUMNAR_COL_SIZE)                            \
    };                                                              \
                                                                    \
    static constexpr std::size_t byteSize(std::uint32_t rows) {     \
      return ::rn_columnar::detail::dataSize(columnSizes, rows);    \
    }                                                               \
                                                                    \
    struct Columns {                                                \
      ColumnsMacro(RN_COLUMNAR_DECL_SPAN)                           \
    };                                                              \
                                                                    \
    template <typename Builder>                                     \
    static Columns layoutColumns(Builder& builder) {                \
      return Columns{                                               \
        ColumnsMacro(RN_COLUMNAR_ADD_COLUMN)                        \
      };                                                            \
    }                                                               \
                                                                    \
    template <typename Builder>                                     \
    [[deprecated("Use writer.columns()")]]                          \
    static Columns& createColumns(Builder& builder) {               \
      return builder.columns();                                     \
    }                                                               \
  };

// Backward-compatible alias.
#define DECLARE_BINARY_SCHEMA(SchemaName, ColumnsMacro) \
  RN_COLUMNAR_DECLARE_SCHEMA(SchemaName, ColumnsMacro)

// Total ArrayBuffer size (header + columns) for `rows` rows of `Schema`.
template <typename Schema>
constexpr std::size_t bufferSize(std::uint32_t rows) {
  return detail::kDataStart + Schema::byteSize(rows);
}

class VectorBuffer final : public facebook::jsi::MutableBuffer {
 public:
  explicit VectorBuffer(Bytes&& data) : data_(std::move(data)) {}

  size_t size() const override {
    return data_.size();
  }

  uint8_t* data() override {
    return data_.data();
  }

 private:
  Bytes data_;
};

// Owns a new buffer and hands it over to JS with toArrayBuffer().
// Doesn't need a jsi::Runtime until toArrayBuffer(), so it can be filled on any thread.
template <typename Schema>
class ColumnarWriter {
 public:
  using Columns = typename Schema::Columns;

  explicit ColumnarWriter(std::uint32_t rows, Init init = Init::Zeroed)
      : rows_(rows), zeroed_(init == Init::Zeroed) {
    allocate(buffer_, bufferSize<Schema>(rows));
    relayout();
  }

  std::uint32_t rows() const {
    return rows_;
  }

  // Spans point into the buffer and are valid only until resize() or toArrayBuffer().
  // An `auto&` reference to the result stays valid across resize().
  Columns& columns() {
    ensureNotReleased();
    return columns_;
  }

  // Changes the row count, keeping the first min(old, new) rows of every column.
  // New rows are zero-filled (left uninitialized with Init::Uninitialized).
  // Use it to grow while filling and to trim to the final count.
  void resize(std::uint32_t rows) {
    ensureNotReleased();
    if (rows == rows_) {
      return;
    }
    const std::size_t newSize = bufferSize<Schema>(rows);
    const std::uint32_t kept = std::min(rows, rows_);

    if (rows < rows_) {
      // Every column only moves towards the start, so in-order memmove never clobbers unread data.
      forEachColumn(rows_, rows, [&](std::size_t from, std::size_t to, std::size_t size) {
        std::memmove(buffer_.data() + to, buffer_.data() + from, kept * size);
      });
      buffer_.resize(newSize);
      if (buffer_.capacity() > 2 * buffer_.size()) {
        buffer_.shrink_to_fit();
      }
    } else {
      Bytes grown;
      allocate(grown, newSize);
      forEachColumn(rows_, rows, [&](std::size_t from, std::size_t to, std::size_t size) {
        std::memcpy(grown.data() + to, buffer_.data() + from, kept * size);
      });
      buffer_ = std::move(grown);
    }

    rows_ = rows;
    relayout();
  }

  // Hands the buffer over to JS; the writer and its columns are unusable afterwards.
  facebook::jsi::ArrayBuffer toArrayBuffer(facebook::jsi::Runtime& rt) && {
    return release(rt);
  }

  [[deprecated("Use std::move(writer).toArrayBuffer(rt)")]]
  facebook::jsi::ArrayBuffer toArrayBuffer(facebook::jsi::Runtime& rt) & {
    return release(rt);
  }

 private:
  void allocate(Bytes& bytes, std::size_t size) const {
    if (zeroed_) {
      bytes.resize(size, 0);
    } else {
      bytes.resize(size);
    }
  }

  void relayout() {
    columns_ = detail::layout<Schema>(buffer_.data(), buffer_.size(), rows_);
  }

  // Calls fn(fromOffset, toOffset, elementSize) per column for two row counts.
  template <typename Fn>
  static void forEachColumn(std::uint32_t fromRows, std::uint32_t toRows, Fn&& fn) {
    std::size_t from = detail::kDataStart;
    std::size_t to = detail::kDataStart;
    for (std::size_t size : Schema::columnSizes) {
      from = detail::alignTo(from, size);
      to = detail::alignTo(to, size);
      fn(from, to, size);
      from += fromRows * size;
      to += toRows * size;
    }
  }

  facebook::jsi::ArrayBuffer release(facebook::jsi::Runtime& rt) {
    ensureNotReleased();
    facebook::jsi::ArrayBuffer result(
      rt,
      std::make_shared<VectorBuffer>(std::move(buffer_))
    );
    released_ = true;
    columns_ = Columns{};
    return result;
  }

  void ensureNotReleased() const {
    if (released_) {
      throw std::logic_error("rn_columnar: writer used after toArrayBuffer()");
    }
  }

  std::uint32_t rows_;
  bool zeroed_;
  bool released_ = false;
  Bytes buffer_;
  Columns columns_{};
};

// Previous name, kept for compatibility.
template <typename Schema>
using ColumnarWriterBuilder = ColumnarWriter<Schema>;

// Writes into an existing ArrayBuffer (e.g. allocated once in JS and reused every frame),
// so nothing is allocated per call. The buffer may be larger than needed: the header
// stores the actual row count. Old bytes are not cleared — write every cell.
// Use on the JS thread only, and re-read the buffer in JS after each write.
template <typename Schema>
class ColumnarBufferWriter {
 public:
  using Columns = typename Schema::Columns;

  ColumnarBufferWriter(
      facebook::jsi::Runtime& rt,
      const facebook::jsi::ArrayBuffer& buffer,
      std::uint32_t rows)
      : rows_(rows) {
    const std::size_t size = buffer.size(rt);
    if (size < bufferSize<Schema>(rows)) {
      throw std::length_error("rn_columnar: ArrayBuffer is too small for the requested row count");
    }
    std::uint8_t* data = buffer.data(rt);
    if (reinterpret_cast<std::uintptr_t>(data) % 8 != 0) {
      throw std::logic_error("rn_columnar: ArrayBuffer data is not 8-byte aligned");
    }
    columns_ = detail::layout<Schema>(data, size, rows);
  }

  // Max rows that fit into a buffer of `byteLength` bytes.
  static std::uint32_t capacity(std::size_t byteLength) {
    if (byteLength < detail::kDataStart) {
      return 0;
    }
    std::size_t rowBytes = 0;
    for (std::size_t size : Schema::columnSizes) {
      rowBytes += size;
    }
    // Upper bound ignoring padding; keeps bufferSize(mid) from overflowing size_t.
    std::uint32_t lo = 0;
    std::uint32_t hi = static_cast<std::uint32_t>(
        std::min<std::size_t>((byteLength - detail::kDataStart) / rowBytes, UINT32_MAX));
    while (lo < hi) {
      const std::uint32_t mid = lo + (hi - lo + 1) / 2;
      if (bufferSize<Schema>(mid) <= byteLength) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  }

  std::uint32_t rows() const {
    return rows_;
  }

  Columns& columns() {
    return columns_;
  }

 private:
  std::uint32_t rows_;
  Columns columns_{};
};

} // namespace rn_columnar
