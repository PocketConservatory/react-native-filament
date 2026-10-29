//
// Created by Marc Rousavy on 21.02.24.
//

#include "RNFJSurfaceProvider.h"
#include <android/log.h>

namespace margelo {

JSurfaceProvider::JSurfaceProvider(const jni::alias_ref<jhybridobject>& javaThis) : SurfaceProvider(), _javaPart(make_global(javaThis)) {}

JSurfaceProvider::~JSurfaceProvider() {
  __android_log_write(ANDROID_LOG_INFO, TAG, "Destroying JSurfaceProvider...");
}

void JSurfaceProvider::registerNatives() {
  registerHybrid({
      makeNativeMethod("initHybrid", JSurfaceProvider::initHybrid),
      makeNativeMethod("onSurfaceCreated", JSurfaceProvider::onSurfaceCreated),
      makeNativeMethod("onSurfaceChanged", JSurfaceProvider::onSurfaceChanged),
      makeNativeMethod("onSurfaceDestroyed", JSurfaceProvider::onSurfaceDestroyed),
  });
}

jni::local_ref<JSurfaceProvider::jhybriddata> JSurfaceProvider::initHybrid(jni::alias_ref<jhybridobject> jThis) {
  __android_log_write(ANDROID_LOG_INFO, TAG, "Initializing JSurfaceProvider...");
  return makeCxxInstance(jThis);
}

void JSurfaceProvider::onSurfaceCreated(jni::alias_ref<jobject> javaSurface) {
  std::shared_ptr<AndroidSurface> surface;
  {
    std::unique_lock lock(_surfaceMutex);
    if (_surface == nullptr || _surface->getJavaSurface() != javaSurface) {
      _surface = std::make_shared<AndroidSurface>(javaSurface);
    }
    surface = _surface;
  }
  SurfaceProvider::onSurfaceCreated(surface);
}

void JSurfaceProvider::onSurfaceChanged(jni::alias_ref<jobject> javaSurface, int width, int height) {
  std::shared_ptr<AndroidSurface> surface;
  {
    std::unique_lock lock(_surfaceMutex);
    if (_surface == nullptr || _surface->getJavaSurface() != javaSurface) {
      _surface = std::make_shared<AndroidSurface>(javaSurface);
    }
    surface = _surface;
  }
  SurfaceProvider::onSurfaceChanged(surface, width, height);
}

void JSurfaceProvider::onSurfaceDestroyed(jni::alias_ref<jobject> javaSurface, jni::alias_ref<jni::JRunnable> releaseSurface) {
  std::shared_ptr<AndroidSurface> surface;
  {
    // From here on, creating a swapchain for this surface fails.
    std::unique_lock lock(_surfaceMutex);
    if (_surface != nullptr && _surface->getJavaSurface() == javaSurface) {
      surface = std::move(_surface);
    }
  }

  // Java releases the Surface and SurfaceTexture when the last guard is gone: right away if no engine uses the
  // surface, otherwise after the engine destroyed its swapchain on the render thread. This never blocks the UI thread.
  auto* release = new jni::global_ref<jni::JRunnable::javaobject>(jni::make_global(releaseSurface));
  std::shared_ptr<void> releaseGuard(release, [](jni::global_ref<jni::JRunnable::javaobject>* release) {
    jni::ThreadScope::WithClassLoader([&]() {
      try {
        static const auto run = jni::JRunnable::javaClassStatic()->getMethod<void()>("run");
        run(*release);
      } catch (const std::exception& error) {
        __android_log_print(ANDROID_LOG_ERROR, TAG, "Failed to release the surface: %s", error.what());
      }
      delete release;
    });
  });

  // Listeners only know the tracked surface. If another one is destroyed, the guard is dropped here and Java releases
  // it right away.
  if (surface != nullptr) {
    SurfaceProvider::onSurfaceDestroyed(surface, std::move(releaseGuard));
  }
}

std::shared_ptr<Surface> JSurfaceProvider::getSurfaceOrNull() {
  std::unique_lock lock(_surfaceMutex);
  return _surface;
}

} // namespace margelo
