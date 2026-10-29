//
// Created by Hanno Gödecke on 02.05.24.
//

#include "RNFChoreographerWrapper.h"
#include "threading/RNFDispatcher.h"

namespace margelo {

// Will be called on automatic removal (can happen when the runtime gets destroyed, and onRuntimeDestroyed would be called later)
ChoreographerWrapper::~ChoreographerWrapper() {
  std::unique_lock lock(_mutex);
  stopAndRemoveListeners();
}

void ChoreographerWrapper::loadHybridMethods() {
  registerHybridMethod("start", &ChoreographerWrapper::start, this);
  registerHybridMethod("stop", &ChoreographerWrapper::stop, this);
  registerHybridMethod("addFrameCallbackListener", &ChoreographerWrapper::addFrameCallbackListener, this);
  registerHybridMethod("release", &ChoreographerWrapper::release, this, true);
}

void ChoreographerWrapper::start() {
  std::unique_lock lock(_mutex);

  pointee()->start();
}

void ChoreographerWrapper::stop() {
  std::unique_lock lock(_mutex);

  pointee()->stop();
}

jsi::Value ChoreographerWrapper::addFrameCallbackListener(jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args, size_t count) {
  if (count != 1) {
    throw jsi::JSError(runtime, "addFrameCallbackListener(callback) expects exactly one argument!");
  }

  // The callback holds a jsi::Function of this runtime, but the listener list may drop it on any thread (JS, GC, frame
  // thread). Always destroy it on this runtime's thread.
  std::shared_ptr<Dispatcher> dispatcher = Dispatcher::getRuntimeGlobalDispatcher(runtime);
  std::shared_ptr<RenderCallback> onFrameCallback(
      new RenderCallback(JSIConverter<RenderCallback>::fromJSI(runtime, args[0])),
      [dispatcher](RenderCallback* callback) { dispatcher->runAsync([callback]() { delete callback; }); });

  // Not holding _mutex here: frames take the listener list lock before createFrameInfo() takes _mutex.
  Logger::log(TAG, "Adding frame callback listener");

  std::weak_ptr<ChoreographerWrapper> weakThis = shared<ChoreographerWrapper>();
  std::shared_ptr<Listener> listener = pointee()->addOnFrameListener([weakThis, onFrameCallback](double timestamp) {
    auto sharedThis = weakThis.lock();
    if (sharedThis) {
      FrameInfo frameInfo = sharedThis->createFrameInfo(timestamp);
      (*onFrameCallback)(frameInfo);
    }
  });
  return JSIConverter<std::shared_ptr<Listener>>::toJSI(runtime, listener);
}

FrameInfo ChoreographerWrapper::createFrameInfo(double timestamp) {
  std::unique_lock lock(_mutex);

  if (_startTime == 0) {
    [[unlikely]];
    _startTime = timestamp;
  }

  double passedSeconds = (timestamp - _startTime) / 1e9;
  double timeSinceLastFrame = (timestamp - _lastFrameTime) / 1e9;
  _lastFrameTime = timestamp;
  return {
      {"timestamp", timestamp},
      {"passedSeconds", passedSeconds},
      {"startTime", _startTime},
      {"timeSinceLastFrame", timeSinceLastFrame},
  };
}

void ChoreographerWrapper::stopAndRemoveListeners() {
  // Its possible that the pointer was already released manually by the user
  if (!getIsValid()) {
    Logger::log(TAG, "stopAndRemoveListeners() called but Choreographer is invalid already!");
    return;
  }

  Logger::log(TAG, "Stopping choreographer and removing listeners...");
  pointee()->stop();
  // Clear all listeners now - that will cause the listeners function destructors to be called
  // When onRuntimeDestroyed gets called we still have time to stopAndRemoveListeners our jsi functions (RenderCallback):
  pointee()->removeAllListeners();
}

void ChoreographerWrapper::release() {
  std::unique_lock lock(_mutex);
  stopAndRemoveListeners();
  PointerHolder::release();
}

void ChoreographerWrapper::onRuntimeDestroyed(jsi::Runtime*) {
  std::unique_lock lock(_mutex);
  Logger::log(TAG, "Runtime destroyed...");
  stopAndRemoveListeners();
}

std::shared_ptr<Choreographer> ChoreographerWrapper::getChoreographer() {
  if (getIsValid()) {
    return pointee();
  }
  return nullptr;
}

} // namespace margelo
