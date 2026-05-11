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
  
  
  rt.global().setProperty(rt, "__testArrayBuffer", std::move(testArrayBuffer));
  rt.global().setProperty(rt, "__testArrayOfObject", std::move(testArrayOfObject));
}
@end



