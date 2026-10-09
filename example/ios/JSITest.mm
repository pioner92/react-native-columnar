//
//  JSITest.m
//  ColumnarExample
//
//  Created by Oleksandr Shumihin on 11/05/2026.
//

#import <Foundation/Foundation.h>

#import <React/RCTBridge+Private.h>
#import <React/RCTBridge.h>
#import <ReactCommon/RCTTurboModule.h>
#import <ReactCommon/CallInvoker.h>
#import <iostream>
#import <thread>
#import "React/RCTBridgeModule.h"
#import "jsi/jsi.h"
#include "react/bridging/Bridging.h"
#include "react-native-columnar.h"

#define MY_COLUMNS(X) \
  X(int32_t, id)        \
  X(uint8_t, status)    \
  X(uint8_t, isActive)  \
  X(double, createdAt)  \
  X(double, updatedAt)  \

RN_COLUMNAR_DECLARE_SCHEMA(RowsStruct, MY_COLUMNS)

#define ALL_TYPES_COLUMNS(X) \
  X(int8_t,   col_int8)    \
  X(uint8_t,  col_uint8)   \
  X(int16_t,  col_int16)   \
  X(uint16_t, col_uint16)  \
  X(int32_t,  col_int32)   \
  X(uint32_t, col_uint32)  \
  X(float,    col_float32) \
  X(double,   col_float64) \

RN_COLUMNAR_DECLARE_SCHEMA(AllTypesStruct, ALL_TYPES_COLUMNS)


using namespace facebook;

// ============================================================
// Bindings for the react-native-harness tests (example/__tests__)
// ============================================================

namespace {

using namespace rn_columnar;

// Row i of the test data; mirrored by expectedRow() in example/__tests__/helpers.ts.
void fillRow(RowsStruct::Columns& c, uint32_t i) {
  c.id[i] = static_cast<int32_t>(i) * 7 - 3;
  c.status[i] = static_cast<uint8_t>(i % 3);
  c.isActive[i] = static_cast<uint8_t>(i & 1);
  c.createdAt[i] = 1710000000000.0 + i * 0.5;
  c.updatedAt[i] = 1720000000000.0 + i;
}

uint32_t argRows(jsi::Runtime& rt, const jsi::Value* args, size_t count, size_t index) {
  if (index >= count || !args[index].isNumber() || args[index].asNumber() < 0) {
    throw jsi::JSError(rt, "expected a non-negative row count");
  }
  return static_cast<uint32_t>(args[index].asNumber());
}

// Optional boolean argument: true selects Init::Uninitialized.
Init argInit(const jsi::Value* args, size_t count, size_t index) {
  const bool uninitialized = index < count && args[index].isBool() && args[index].getBool();
  return uninitialized ? Init::Uninitialized : Init::Zeroed;
}

void setFunction(jsi::Runtime& rt, const char* name, unsigned params, jsi::HostFunctionType fn) {
  rt.global().setProperty(
    rt, name, jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, name), params, std::move(fn)));
}

void installTestBindings(jsi::Runtime& rt, std::shared_ptr<react::CallInvoker> jsInvoker) {
  // (rows, uninitialized?) -> ArrayBuffer with fillRow data
  setFunction(rt, "__columnarRows", 2, [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
    const uint32_t rows = argRows(rt, args, count, 0);
    ColumnarWriter<RowsStruct> writer(rows, argInit(args, count, 1));
    auto& cols = writer.columns();
    for (uint32_t i = 0; i < rows; ++i) {
      fillRow(cols, i);
    }
    return std::move(writer).toArrayBuffer(rt);
  });

  // (initialRows, finalRows, uninitialized?) -> initialRows filled, then resize(finalRows)
  setFunction(rt, "__columnarResize", 3, [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
    const uint32_t initialRows = argRows(rt, args, count, 0);
    const uint32_t finalRows = argRows(rt, args, count, 1);
    ColumnarWriter<RowsStruct> writer(initialRows, argInit(args, count, 2));
    auto& cols = writer.columns();
    for (uint32_t i = 0; i < initialRows; ++i) {
      fillRow(cols, i);
    }
    writer.resize(finalRows);
    return std::move(writer).toArrayBuffer(rt);
  });

  // (rows, uninitialized?) -> starts with capacity 1, doubles while filling, trims to rows
  setFunction(rt, "__columnarGrow", 2, [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
    const uint32_t rows = argRows(rt, args, count, 0);
    ColumnarWriter<RowsStruct> writer(1, argInit(args, count, 1));
    auto& cols = writer.columns();
    for (uint32_t i = 0; i < rows; ++i) {
      if (i == writer.rows()) {
        writer.resize(writer.rows() * 2);
      }
      fillRow(cols, i);
    }
    writer.resize(rows);
    return std::move(writer).toArrayBuffer(rt);
  });

  // (rows) -> all 8 column types with per-row values; mirrored by expectedAllTypes() in helpers.ts
  setFunction(rt, "__columnarAllTypes", 1, [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
    const uint32_t rows = argRows(rt, args, count, 0);
    ColumnarWriter<AllTypesStruct> writer(rows);
    auto& c = writer.columns();
    for (uint32_t i = 0; i < rows; ++i) {
      c.col_int8[i] = static_cast<int8_t>(-1 - static_cast<int>(i % 100));
      c.col_uint8[i] = static_cast<uint8_t>(200 + i % 50);
      c.col_int16[i] = static_cast<int16_t>(-1000 * static_cast<int>(i % 30));
      c.col_uint16[i] = static_cast<uint16_t>(60000 + i % 5000);
      c.col_int32[i] = -100000 * static_cast<int32_t>(i);
      c.col_uint32[i] = 3000000000u + i;
      c.col_float32[i] = 1.5f * static_cast<float>(i);
      c.col_float64[i] = 1234567890.25 * i;
    }
    return std::move(writer).toArrayBuffer(rt);
  });

  // (action) -> performs `action` on a writer after toArrayBuffer(); must throw
  setFunction(rt, "__columnarUseAfterRelease", 1, [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
    if (count < 1 || !args[0].isString()) {
      throw jsi::JSError(rt, "expected an action name");
    }
    const std::string action = args[0].asString(rt).utf8(rt);
    ColumnarWriter<RowsStruct> writer(1);
    auto released = std::move(writer).toArrayBuffer(rt);
    if (action == "columns") {
      writer.columns();
    } else if (action == "resize") {
      writer.resize(2);
    } else if (action == "toArrayBuffer") {
      auto again = std::move(writer).toArrayBuffer(rt);
    } else {
      throw jsi::JSError(rt, "unknown action: " + action);
    }
    return jsi::Value::undefined();
  });

  // (buffer, rows) -> refills an existing ArrayBuffer with fillRow data via ColumnarBufferWriter
  setFunction(rt, "__columnarFill", 2, [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
    if (count < 1 || !args[0].isObject() || !args[0].asObject(rt).isArrayBuffer(rt)) {
      throw jsi::JSError(rt, "expected an ArrayBuffer");
    }
    const auto buffer = args[0].asObject(rt).getArrayBuffer(rt);
    const uint32_t rows = argRows(rt, args, count, 1);
    ColumnarBufferWriter<RowsStruct> writer(rt, buffer, rows);
    for (uint32_t i = 0; i < rows; ++i) {
      fillRow(writer.columns(), i);
    }
    return jsi::Value::undefined();
  });

  // (byteLength) -> rows that fit into a buffer of that size
  setFunction(rt, "__columnarCapacity", 1, [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
    const uint32_t byteLength = argRows(rt, args, count, 0);
    return static_cast<double>(ColumnarBufferWriter<RowsStruct>::capacity(byteLength));
  });

  // (rows) -> bufferSize<RowsStruct>(rows), compared with JS getBufferSize()
  setFunction(rt, "__columnarBufferSize", 1, [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
    return static_cast<double>(bufferSize<RowsStruct>(argRows(rt, args, count, 0)));
  });

  // (rows, fail?) -> Promise<ArrayBuffer> filled on a background thread (the README pattern)
  setFunction(rt, "__columnarAsync", 2, [jsInvoker](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
    if (!jsInvoker) {
      throw jsi::JSError(rt, "CallInvoker is not available");
    }
    const uint32_t rows = argRows(rt, args, count, 0);
    const bool fail = count > 1 && args[1].isBool() && args[1].getBool();

    auto executor = jsi::Function::createFromHostFunction(
      rt, jsi::PropNameID::forAscii(rt, "executor"), 2,
      [jsInvoker, rows, fail](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t) -> jsi::Value {
        auto resolve = std::make_shared<jsi::Value>(rt, args[0]);
        auto reject = std::make_shared<jsi::Value>(rt, args[1]);

        std::thread([jsInvoker, rows, fail, resolve = std::move(resolve), reject = std::move(reject)]() mutable {
          std::shared_ptr<ColumnarWriter<RowsStruct>> writer;
          std::string error;
          try {
            if (fail) {
              throw std::runtime_error("requested failure");
            }
            writer = std::make_shared<ColumnarWriter<RowsStruct>>(rows, Init::Uninitialized);
            auto& cols = writer->columns();
            for (uint32_t i = 0; i < rows; ++i) {
              fillRow(cols, i);
            }
          } catch (const std::exception& e) {
            error = e.what();
          }

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

} // namespace


@interface JSITest : NSObject <RCTBridgeModule>

@end



@implementation JSITest
RCT_EXPORT_MODULE()

@synthesize bridge = _bridge;
@synthesize methodQueue = _methodQueue;

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

- (void)setBridge:(RCTBridge*)bridge {
  _bridge = bridge;


  RCTCxxBridge* cxxBridge = (RCTCxxBridge*)self.bridge;
  if (!cxxBridge.runtime) {
    return;
  }

  auto jsiRuntime = (jsi::Runtime*)cxxBridge.runtime;

  auto callInvoker = cxxBridge.jsCallInvoker;

  init_module(jsiRuntime, callInvoker);
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(install){
  NSLog(@"Installing JSI bindings for react-native-columnar example ...");
  RCTBridge* bridge = [RCTBridge currentBridge];
  RCTCxxBridge* cxxBridge = (RCTCxxBridge*)bridge;

  if (cxxBridge == nil) {
    return @false;
  }

  auto jsiRuntime = (jsi::Runtime*) cxxBridge.runtime;
  if (jsiRuntime == nil) {
    return @false;
  }

  init_module(jsiRuntime, cxxBridge.jsCallInvoker);

  return @true;
}


void init_module(jsi::Runtime* runtime, std::shared_ptr<react::CallInvoker> callInvoker) {
  jsi::Runtime& rt = *runtime;
  
  using namespace rn_columnar;
  
  // All benchmark variants return the same data for `rows` rows (args[0]).
  auto rowCount = [](jsi::Runtime &rt, const jsi::Value *args, size_t count) -> uint32_t {
    if (count < 1 || !args[0].isNumber()) {
      throw jsi::JSError(rt, "expected a row count");
    }
    return static_cast<uint32_t>(args[0].asNumber());
  };

  jsi::Function testArrayOfObject = jsi::Function::createFromHostFunction(
    rt, jsi::PropNameID::forAscii(rt, "testArrayOfObject"), 1,
    [rowCount](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) {
      const uint32_t rows = rowCount(rt, args, count);

      // Property names are created once per call, not once per row.
      const auto id = jsi::PropNameID::forAscii(rt, "id");
      const auto status = jsi::PropNameID::forAscii(rt, "status");
      const auto isActive = jsi::PropNameID::forAscii(rt, "isActive");
      const auto createdAt = jsi::PropNameID::forAscii(rt, "createdAt");
      const auto updatedAt = jsi::PropNameID::forAscii(rt, "updatedAt");

      jsi::Array array(rt, rows);
      for (uint32_t i = 0; i < rows; ++i) {
        jsi::Object ob(rt);
        ob.setProperty(rt, id, static_cast<int>(i));
        ob.setProperty(rt, status, 2);
        ob.setProperty(rt, isActive, 1);
        ob.setProperty(rt, createdAt, 1710000000000.0 + i);
        ob.setProperty(rt, updatedAt, 1720000000000.0 + i);
        array.setValueAtIndex(rt, i, std::move(ob));
      }
      return array;
    });

  jsi::Function testJSON = jsi::Function::createFromHostFunction(
    rt, jsi::PropNameID::forAscii(rt, "testJSON"), 1,
    [rowCount](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) {
      const uint32_t rows = rowCount(rt, args, count);

      std::string json;
      json.reserve(rows * 96 + 2);
      json += '[';
      char row[128];
      for (uint32_t i = 0; i < rows; ++i) {
        const int n = snprintf(row, sizeof(row),
          "%s{\"id\":%u,\"status\":2,\"isActive\":1,\"createdAt\":%.17g,\"updatedAt\":%.17g}",
          i == 0 ? "" : ",", i, 1710000000000.0 + i, 1720000000000.0 + i);
        json.append(row, n);
      }
      json += ']';
      return jsi::String::createFromUtf8(rt, json);
    });

  jsi::Function testArrayBuffer = jsi::Function::createFromHostFunction(
    rt, jsi::PropNameID::forAscii(rt, "testArrayBuffer"), 1,
    [rowCount](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) {
      const uint32_t rows = rowCount(rt, args, count);

      // Every cell is written below, so the zero-fill can be skipped.
      ColumnarWriter<RowsStruct> writer(rows, Init::Uninitialized);
      auto& cols = writer.columns();
      for (uint32_t i = 0; i < rows; ++i) {
        cols.id[i] = static_cast<int32_t>(i);
        cols.status[i] = 2;
        cols.isActive[i] = 1;
        cols.createdAt[i] = 1710000000000.0 + i;
        cols.updatedAt[i] = 1720000000000.0 + i;
      }
      return std::move(writer).toArrayBuffer(rt);
    });

  // Refills an ArrayBuffer allocated once in JS: no allocation per call.
  jsi::Function testFillBuffer = jsi::Function::createFromHostFunction(
    rt, jsi::PropNameID::forAscii(rt, "testFillBuffer"), 2,
    [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) {
      if (count < 2 || !args[0].isObject() || !args[1].isNumber()) {
        throw jsi::JSError(rt, "expected (buffer: ArrayBuffer, rows: number)");
      }
      const auto buffer = args[0].asObject(rt).getArrayBuffer(rt);
      const auto rows = static_cast<uint32_t>(args[1].asNumber());

      ColumnarBufferWriter<RowsStruct> writer(rt, buffer, rows);
      auto& cols = writer.columns();
      for (uint32_t i = 0; i < rows; ++i) {
        cols.id[i] = static_cast<int32_t>(i);
        cols.status[i] = 2;
        cols.isActive[i] = 1;
        cols.createdAt[i] = 1710000000000.0 + i;
        cols.updatedAt[i] = 1720000000000.0 + i;
      }
      return jsi::Value::undefined();
    });

  
  jsi::Function testAllTypes = jsi::Function::createFromHostFunction(
    rt, jsi::PropNameID::forAscii(rt, "testAllTypes"), 0,
    [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *, size_t) {
      constexpr uint32_t rows = 10;

      ColumnarWriter<AllTypesStruct> writer(rows);
      auto& cols = writer.columns();

      for (int i = 0; i < (int)rows; ++i) {
        cols.col_int8[i]    = -5;
        cols.col_uint8[i]   = 250;
        cols.col_int16[i]   = -1000;
        cols.col_uint16[i]  = 65000;
        cols.col_int32[i]   = -100000;
        cols.col_uint32[i]  = 3000000000u;
        cols.col_float32[i] = 1.5f;
        cols.col_float64[i] = 1234567890.0;
      }

      return std::move(writer).toArrayBuffer(rt);
    });

  rt.global().setProperty(rt, "__testArrayBuffer", std::move(testArrayBuffer));
  rt.global().setProperty(rt, "__testArrayOfObject", std::move(testArrayOfObject));
  rt.global().setProperty(rt, "__testJSON", std::move(testJSON));
  rt.global().setProperty(rt, "__testFillBuffer", std::move(testFillBuffer));
  rt.global().setProperty(rt, "__testAllTypes", std::move(testAllTypes));

  installTestBindings(rt, callInvoker);
}
@end



