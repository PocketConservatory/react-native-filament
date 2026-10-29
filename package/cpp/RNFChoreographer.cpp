//
// Created by Marc Rousavy on 23.02.24.
//

#include "RNFChoreographer.h"
#include "RNFListenerManager.h"

namespace margelo {

std::shared_ptr<Listener> Choreographer::addOnFrameListener(Choreographer::OnFrameCallback onFrameCallback) {
  std::unique_lock lock(_listenersMutex);
  return _listeners->add(std::move(onFrameCallback));
}

void Choreographer::start() {
  _running = true;
  platformStart();
}

void Choreographer::stop() {
  _running = false;
  platformStop();
}

void Choreographer::onFrame(double timestamp) {
  if (!_running) {
    return;
  }
  std::shared_ptr<ListenerManager<OnFrameCallback>> listeners;
  {
    std::unique_lock lock(_listenersMutex);
    listeners = _listeners;
  }
  listeners->forEach([=](const OnFrameCallback& callback) { callback(timestamp); });
}

void Choreographer::removeAllListeners() {
  Logger::log(TAG, "Removing all listeners");
  // Simply create a new ListenerManager, so the memory of the old one gets freed
  // (once a frame that is still iterating it has finished).
  std::shared_ptr<ListenerManager<OnFrameCallback>> oldListeners = ListenerManager<OnFrameCallback>::create();
  {
    std::unique_lock lock(_listenersMutex);
    std::swap(_listeners, oldListeners);
  }
}

} // namespace margelo
