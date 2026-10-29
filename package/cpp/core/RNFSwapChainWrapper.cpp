#include "RNFSwapChainWrapper.h"

#include "RNFLogger.h"

namespace margelo {

void SwapChainLifetime::destroy() {
  if (_destroyed.exchange(true)) {
    return;
  }
  Logger::log("SwapChainLifetime", "Destroying swapchain...");
  _engine->destroy(_swapChain);
  // Required to ensure we don't return before Filament is done executing the destroySwapChain command.
  // Only then may the native window go away: createSwapChain is queued on the backend thread as well, and
  // a swapchain released right after creation would otherwise hand it an already freed window.
  _engine->flushAndWait();
  _nativeWindowOwner = nullptr;
  _engine = nullptr;
  Logger::log("SwapChainLifetime", "Destroyed swapchain!");
}

std::shared_ptr<SwapChain> SwapChainWrapper::getSwapChainOrNull() {
  if (_lifetime->isDestroyed()) {
    return nullptr;
  }
  return pointeeOrNull();
}

bool SwapChainWrapper::getIsValid() {
  return PointerHolder::getIsValid() && !_lifetime->isDestroyed();
}

} // namespace margelo
