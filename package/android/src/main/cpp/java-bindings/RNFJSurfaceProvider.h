//
// Created by Marc Rousavy on 21.02.24.
//

#pragma once

#include "RNFAndroidSurface.h"
#include "RNFSurfaceProvider.h"
#include <fbjni/NativeRunnable.h>
#include <fbjni/fbjni.h>
#include <jni.h>
#include <mutex>

namespace margelo {

using namespace facebook;

class JSurfaceProvider : public jni::HybridClass<JSurfaceProvider>, public SurfaceProvider {
public:
  ~JSurfaceProvider();
  static void registerNatives();

  void onSurfaceCreated(jni::alias_ref<jobject> surface);
  void onSurfaceChanged(jni::alias_ref<jobject> surface, int width, int height);
  void onSurfaceDestroyed(jni::alias_ref<jobject> surface, jni::alias_ref<jni::JRunnable> releaseSurface);

  std::shared_ptr<Surface> getSurfaceOrNull() override;

private:
  friend HybridBase;
  jni::global_ref<JSurfaceProvider::javaobject> _javaPart;
  // Set on the UI thread, read on the render thread when creating a swapchain.
  std::mutex _surfaceMutex;
  std::shared_ptr<AndroidSurface> _surface;

private:
  static auto constexpr TAG = "JSurfaceProvider";
  static auto constexpr kJavaDescriptor = "Lcom/margelo/filament/SurfaceProvider;";

private:
  explicit JSurfaceProvider(const jni::alias_ref<jhybridobject>& javaThis);
  static jni::local_ref<jhybriddata> initHybrid(jni::alias_ref<jhybridobject> javaThis);
};

} // namespace margelo
