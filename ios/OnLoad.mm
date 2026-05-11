#import <Foundation/Foundation.h>
#import "ColumnarImpl.h"
#import <ReactCommon/CxxTurboModuleUtils.h>

@interface ColumnarOnLoad : NSObject
@end

@implementation ColumnarOnLoad

using namespace facebook::react;

+ (void)load
{
  registerCxxModuleToGlobalModuleMap(
    std::string(ColumnarImpl::kModuleName),
    [](std::shared_ptr<CallInvoker> jsInvoker) {
      return std::make_shared<ColumnarImpl>(jsInvoker);
    }
  );
}

@end
