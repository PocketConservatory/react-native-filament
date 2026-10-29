//
// Created by Marc Rousavy on 23.02.24.
//

#pragma once

#include "RNFListener.h"
#include "RNFListenerManager.h"
#include <atomic>
#include <functional>
#include <mutex>

namespace margelo {

class Choreographer {
public:
  explicit Choreographer() {}
  ~Choreographer() {
    Logger::log("Choreographer", "(MEMORY) Deleting Choreographer... ❌");
  }
  using OnFrameCallback = std::function<void(double timestamp)>;

  std::shared_ptr<Listener> addOnFrameListener(OnFrameCallback onFrameCallback);
  void removeAllListeners();

  void start();
  void stop();

protected:
  void onFrame(double timestamp);

  virtual void platformStart() = 0;
  virtual void platformStop() = 0;

private:
  // Guards the `_listeners` pointer, not the list itself (ListenerManager is thread-safe).
  std::mutex _listenersMutex;
  std::shared_ptr<ListenerManager<OnFrameCallback>> _listeners = ListenerManager<OnFrameCallback>::create();
  // The platform may still deliver a frame that was already scheduled when stop() was called.
  std::atomic_bool _running = false;
  // Keeps _running and the platform state in step across concurrent start()/stop(). onFrame() never takes it, so
  // stop() may be called from a frame callback.
  std::mutex _runningMutex;

private:
  static constexpr auto TAG = "Choreographer";
};

} // namespace margelo
