//
// Created by Marc Rousavy on 12.03.24.
//

#include "RNFJDispatcher.h"
#include <android/log.h>

namespace margelo {

// Both the destructor and scheduleTrigger() can run on threads the JVM knows nothing about, e.g. Hermes'
// GC thread ("hades") finalizing a wrapper that holds the last reference to a Filament resource. The
// resource deleter then calls runAsync() from that thread, so every JNI call here needs a ThreadScope.
JDispatcher::~JDispatcher() {
  jni::ThreadScope::WithClassLoader([&]() {
    __android_log_print(ANDROID_LOG_INFO, "JDispatcher", "Destructor called");
    _javaPart = nullptr;
  });
}

JDispatcher::JDispatcher(const jni::alias_ref<jhybridobject>& javaThis) : _javaPart(jni::make_global(javaThis)) {}

jni::local_ref<JDispatcher::jhybriddata> JDispatcher::initHybrid(jni::alias_ref<jhybridobject> javaThis) {
  return makeCxxInstance(javaThis);
}

void JDispatcher::registerNatives() {
  registerHybrid({makeNativeMethod("initHybrid", JDispatcher::initHybrid), makeNativeMethod("trigger", JDispatcher::trigger)});
}

void JDispatcher::scheduleTrigger() {
  jni::ThreadScope::WithClassLoader([&]() {
    static const auto method = javaClassLocal()->getMethod<void()>("scheduleTrigger");
    method(_javaPart);
  });
}

void JDispatcher::trigger() {
  // Jobs run outside _mutex, so runAsync() on another thread never waits for the running job: callers may hold locks
  // that the job needs. _runMutex keeps jobs one at a time and in order on executors with several threads.
  std::unique_lock runLock(_runMutex);
  std::function<void()> job;
  {
    std::unique_lock lock(_mutex);
    job = std::move(_jobs.front());
    _jobs.pop();
  }
  job();
}

void JDispatcher::runAsync(std::function<void()>&& function) {
  std::unique_lock lock(_mutex);
  _jobs.push(std::move(function));
  scheduleTrigger();
}

void JDispatcher::runSync(std::function<void()>&& function) {
  // TODO: Don't use a mutex here, use a condition variable instead
  _syncMutex.lock();
  runAsync([this, function = std::move(function)]() {
    function();
    _syncMutex.unlock();
  });
  _syncMutex.lock();
  _syncMutex.unlock();
}

} // namespace margelo