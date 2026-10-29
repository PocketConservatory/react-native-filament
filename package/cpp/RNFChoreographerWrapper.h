//
// Created by Hanno Gödecke on 02.05.24.
//

#pragma once

#include "RNFChoreographer.h"
#include "jsi/RNFPointerHolder.h"
#include "jsi/RNFRuntimeCache.h"

namespace margelo {

using FrameInfo = std::unordered_map<std::string, double>;
using RenderCallback = std::function<void(FrameInfo)>;

class ChoreographerWrapper : public PointerHolder<Choreographer>, public RuntimeLifecycleListener {
public:
  explicit ChoreographerWrapper(std::shared_ptr<Choreographer> choreographer) : PointerHolder(TAG, choreographer) {}
  ~ChoreographerWrapper() override;

  void loadHybridMethods() override;

protected:
  std::shared_ptr<Choreographer> getChoreographer();
  friend class FilamentView; // Allow filament view to access protected method

private: // Exposed JS API
  void start();
  void stop();
  jsi::Value addFrameCallbackListener(jsi::Runtime& runtime, const jsi::Value& thisValue, const jsi::Value* args, size_t count);
  void release() override;

private: // Internal
  void stopAndRemoveListeners();
  void onRuntimeDestroyed(jsi::Runtime*) override;
  FrameInfo createFrameInfo(double timestamp);

private:
  std::mutex _mutex;
  double _startTime = 0;
  double _lastFrameTime = 0;

private:
  static constexpr auto TAG = "ChoreographerWrapper";
};
} // namespace margelo
