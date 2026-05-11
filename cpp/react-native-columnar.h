#pragma once
#include <jsi/jsi.h>
#include <span>

namespace rn_columnar {

#define DECL_SPAN(type, name) std::span<type> name;

#define ADD_COLUMN(type, name) .name = builder.template addColumn<type>(),

#define COUNT_COL(type, name) +1

#define ADD_SIZE(type, name) \
  offset = alignTo(offset, alignof(type)); \
  offset += rows * sizeof(type);

// ============================================================
// Schema generator
// ============================================================
#define DECLARE_BINARY_SCHEMA(SchemaName, ColumnsMacro)             \
  struct SchemaName {                                               \
                                                                    \
    static constexpr uint32_t columnCount =                         \
        0 ColumnsMacro(COUNT_COL);                                  \
                                                                    \
    static size_t byteSize(uint32_t rows) {                         \
      size_t offset = 0;                                            \
      ColumnsMacro(ADD_SIZE)                                        \
      return offset;                                                \
    }                                                               \
                                                                    \
    struct Columns {                                                \
      ColumnsMacro(DECL_SPAN)                                       \
    };                                                              \
                                                                    \
    template <typename Builder>                                     \
    static Columns createColumns(Builder& builder) {                \
      return Columns{                                               \
        ColumnsMacro(ADD_COLUMN)                                    \
      };                                                            \
    }                                                               \
                                                                    \
   private:                                                         \
    static size_t alignTo(size_t value, size_t alignment) {         \
      return (value + alignment - 1) & ~(alignment - 1);            \
    }                                                               \
  };

#pragma pack(push, 1)
struct BinaryHeader {
  uint32_t rows;
  uint32_t columns;
};
#pragma pack(pop)

class VectorBuffer final : public facebook::jsi::MutableBuffer {
 public:
  explicit VectorBuffer(std::vector<uint8_t>&& data)
      : data_(std::move(data)) {}

  size_t size() const override {
    return data_.size();
  }

  uint8_t* data() override {
    return data_.data();
  }

 private:
  std::vector<uint8_t> data_;
};

template <typename Schema>
class ColumnarWriterBuilder {
 public:
  explicit ColumnarWriterBuilder(uint32_t rows) : rows_(rows) {
    constexpr size_t kHeaderSize = sizeof(BinaryHeader);
    constexpr size_t kDataStart = (kHeaderSize + 7u) & ~size_t(7u);
    const size_t dataSize = Schema::byteSize(rows);

    buffer_.resize(kDataStart + dataSize, 0);

    auto* header = reinterpret_cast<BinaryHeader*>(buffer_.data());
    header->rows = rows_;
    header->columns = Schema::columnCount;

    offset_ = kDataStart;
  }

  template <typename T>
  std::span<T> addColumn() {
    offset_ = alignTo(offset_, alignof(T));
    const size_t columnOffset = offset_;
    offset_ += rows_ * sizeof(T);
    return std::span<T>(reinterpret_cast<T*>(buffer_.data() + columnOffset), rows_);
  }

  facebook::jsi::ArrayBuffer toArrayBuffer(facebook::jsi::Runtime& rt) {
    return facebook::jsi::ArrayBuffer(
      rt,
      std::make_shared<VectorBuffer>(std::move(buffer_))
    );
  }

 private:
  static size_t alignTo(size_t value, size_t alignment) {
    return (value + alignment - 1) & ~(alignment - 1);
  }

  uint32_t rows_;
  size_t offset_ = 0;
  std::vector<uint8_t> buffer_;
};

} // namespace rn_columnar
