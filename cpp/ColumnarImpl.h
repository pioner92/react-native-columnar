#pragma once

#include <ColumnarSpecJSI.h>

#include <memory>

namespace facebook::react {

class ColumnarImpl
  : public NativeColumnarCxxSpec<ColumnarImpl> {
public:
  ColumnarImpl(std::shared_ptr<CallInvoker> jsInvoker);

  double multiply(jsi::Runtime& rt, double a, double b);
};

}
