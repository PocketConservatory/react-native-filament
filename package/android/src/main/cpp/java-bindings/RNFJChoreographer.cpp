//
// Created by Marc Rousavy on 23.02.24.
//

#include "RNFJChoreographer.h"
#include <android/choreographer.h>

namespace margelo {

void JChoreographer::registerNatives() {
  registerHybrid({
      makeNativeMethod("initHybrid", JChoreographer::initHybrid),
      makeNativeMethod("onFrame", JChoreographer::onFrameLong),
  });
}

JChoreographer::JChoreographer(const jni::alias_ref<jhybridobject>& javaThis) : _javaPart(jni::make_global(javaThis)) {}

jni::local_ref<JChoreographer::jhybriddata> JChoreographer::initHybrid(jni::alias_ref<jhybridobject> javaThis) {
  return makeCxxInstance(javaThis);
}

void JChoreographer::onFrameLong(jlong timestamp) {
  onFrame(static_cast<double>(timestamp));
}

// stop() also runs from ~ChoreographerWrapper, which Hermes may call on its GC thread, a thread the JVM does not know.
void JChoreographer::platformStart() {
  jni::ThreadScope::WithClassLoader([&]() {
    static const auto method = javaClassLocal()->getMethod<void()>("start");
    method(_javaPart);
  });
}

void JChoreographer::platformStop() {
  jni::ThreadScope::WithClassLoader([&]() {
    static const auto method = javaClassLocal()->getMethod<void()>("stop");
    method(_javaPart);
  });
}

} // namespace margelo