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
#import <iostream>
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

DECLARE_BINARY_SCHEMA(RowsStruct, MY_COLUMNS)

#define ALL_TYPES_COLUMNS(X) \
  X(int8_t,   col_int8)    \
  X(uint8_t,  col_uint8)   \
  X(int16_t,  col_int16)   \
  X(uint16_t, col_uint16)  \
  X(int32_t,  col_int32)   \
  X(uint32_t, col_uint32)  \
  X(float,    col_float32) \
  X(double,   col_float64) \

DECLARE_BINARY_SCHEMA(AllTypesStruct, ALL_TYPES_COLUMNS)


using namespace facebook;


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

  init_module(jsiRuntime);
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(install){
  NSLog(@"Installing JSI bindings for react-native-ulid-jsi ...");
  RCTBridge* bridge = [RCTBridge currentBridge];
  RCTCxxBridge* cxxBridge = (RCTCxxBridge*)bridge;

  if (cxxBridge == nil) {
    return @false;
  }

  auto jsiRuntime = (jsi::Runtime*) cxxBridge.runtime;
  if (jsiRuntime == nil) {
    return @false;
  }

  init_module(jsiRuntime);

  return @true;
}


void init_module(jsi::Runtime* runtime) {
  jsi::Runtime& rt = *runtime;
  
  using namespace rn_columnar;
  
  jsi::Function testArrayOfObject = jsi::Function::createFromHostFunction(
                                                             rt, jsi::PropNameID::forAscii(rt, "testArrayOfObject"), 0,
                                                             [](jsi::Runtime &rt, const jsi::Value &thisVal, const jsi::Value *args,
                                                                size_t count) {
                                                                  
                                                                  constexpr const uint32_t rows = 100;
                                                                  
                                                                  jsi::Array array(rt, rows);
                                                                  
                                                                  for(int i = 0; i < rows; ++i){
                                                                    jsi::Object ob(rt);
                                                                    
                                                                    ob.setProperty(rt, "id", i);
                                                                    ob.setProperty(rt, "status", 2);
                                                                    ob.setProperty(rt, "isActive", true);
                                                                    ob.setProperty(rt, "created_at", 1710000000000.0);
                                                                    ob.setProperty(rt, "updated_at", 1710000000000.0);
                                                                    
                                                                    array.setValueAtIndex(rt, i, std::move(ob));
                                                                  }
                                                                  
                                                                  return array;
                                                                });
  
  
  jsi::Function testArrayBuffer = jsi::Function::createFromHostFunction(
                                                             rt, jsi::PropNameID::forAscii(rt, "testArrayBuffer"), 0,
                                                             [](jsi::Runtime &rt, const jsi::Value &thisVal, const jsi::Value *args,
                                                                size_t count) {
                                                                  
                                                                  constexpr uint32_t rows = 100;
                                                                  
                                                                  ColumnarWriterBuilder<RowsStruct> builder(rows);
                                                                  auto cols = RowsStruct::createColumns(builder);
                                                                
                                                                  for(int i = 0; i < rows; ++i){
                                                                    cols.id[i] = i;
                                                                    cols.status[i] = 0;
                                                                    cols.isActive[i] = 1;
                                                                    cols.createdAt[i] = 1710000000000.0;
                                                                    cols.updatedAt[i] = 1310000000000.0;
                                                                  }
                                                                  
                                                                  return builder.toArrayBuffer(rt);
                                                                });
  
  
  jsi::Function testAllTypes = jsi::Function::createFromHostFunction(
    rt, jsi::PropNameID::forAscii(rt, "testAllTypes"), 0,
    [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *, size_t) {
      constexpr uint32_t rows = 10;

      ColumnarWriterBuilder<AllTypesStruct> builder(rows);
      auto cols = AllTypesStruct::createColumns(builder);

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

      return builder.toArrayBuffer(rt);
    });

  rt.global().setProperty(rt, "__testArrayBuffer", std::move(testArrayBuffer));
  rt.global().setProperty(rt, "__testArrayOfObject", std::move(testArrayOfObject));
  rt.global().setProperty(rt, "__testAllTypes", std::move(testAllTypes));
}
@end



