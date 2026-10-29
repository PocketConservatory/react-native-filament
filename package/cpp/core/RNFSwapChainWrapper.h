#pragma once

#include "jsi/RNFPointerHolder.h"

#include <atomic>
#include <filament/Engine.h>
#include <filament/SwapChain.h>
#include <memory>

namespace margelo {
using namespace filament;

/**
 * Destroys a Filament SwapChain exactly once. The swapchain's deleter calls `destroy()`, and native code may call it
 * earlier, e.g. when the native window goes away, while JS still holds the swapchain.
 */
class SwapChainLifetime {
public:
  /**
   * `nativeWindowOwner` is kept alive until Filament has destroyed the swapchain, so the native window
   * (Surface, recorder) cannot be released while the backend still holds it.
   */
  SwapChainLifetime(std::shared_ptr<Engine> engine, SwapChain* swapChain, std::shared_ptr<void> nativeWindowOwner)
      : _engine(std::move(engine)), _swapChain(swapChain), _nativeWindowOwner(std::move(nativeWindowOwner)) {}

  /**
   * Destroys the swapchain and waits for Filament to finish. Must run on the render thread, which is also the only thread
   * that renders into the swapchain, so a render-thread check of `isDestroyed()` cannot race with it.
   */
  void destroy();
  bool isDestroyed() const {
    return _destroyed.load();
  }
  /**
   * Whether this swapchain renders into the native window owned by `owner`. Render thread only.
   */
  bool isOwnedBy(const std::shared_ptr<void>& owner) const {
    return !_nativeWindowOwner.owner_before(owner) && !owner.owner_before(_nativeWindowOwner);
  }

private:
  std::shared_ptr<Engine> _engine;
  SwapChain* _swapChain;
  std::shared_ptr<void> _nativeWindowOwner;
  std::atomic_bool _destroyed = false;
};

class SwapChainWrapper : public PointerHolder<SwapChain> {
public:
  explicit SwapChainWrapper(std::shared_ptr<SwapChain> swapChain, std::shared_ptr<SwapChainLifetime> lifetime)
      : PointerHolder("SwapChainWrapper", swapChain), _lifetime(std::move(lifetime)) {}

  void loadHybridMethods() override {}

  std::shared_ptr<SwapChain> getSwapChain() {
    return pointee();
  }

  /**
   * The swapchain, or nullptr if JS released it or native code destroyed it.
   */
  std::shared_ptr<SwapChain> getSwapChainOrNull();

  std::shared_ptr<SwapChainLifetime> getLifetime() {
    return _lifetime;
  }

protected:
  bool getIsValid() override;

private:
  std::shared_ptr<SwapChainLifetime> _lifetime;
};
} // namespace margelo
