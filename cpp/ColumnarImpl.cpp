#include "ColumnarImpl.h"

namespace facebook::react {

ColumnarImpl::ColumnarImpl(
  std::shared_ptr<CallInvoker> jsInvoker
)
  : NativeColumnarCxxSpec(std::move(jsInvoker)) {}

double ColumnarImpl::multiply(
  jsi::Runtime& rt,
  double a,
  double b
) {
  return a * b;
}

}
