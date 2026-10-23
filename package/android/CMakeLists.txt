project(RNFilament)
cmake_minimum_required(VERSION 3.9.0)

set(PACKAGE_NAME "react-native-filament")
include(FetchContent)
set(WEBP_BUILD_ANIM_UTILS OFF CACHE BOOL "" FORCE)
set(WEBP_BUILD_CWEBP OFF CACHE BOOL "" FORCE)
set(WEBP_BUILD_DWEBP OFF CACHE BOOL "" FORCE)
set(WEBP_BUILD_GIF2WEBP OFF CACHE BOOL "" FORCE)
set(WEBP_BUILD_IMG2WEBP OFF CACHE BOOL "" FORCE)
set(WEBP_BUILD_VWEBP OFF CACHE BOOL "" FORCE)
set(WEBP_BUILD_WEBPINFO OFF CACHE BOOL "" FORCE)
set(WEBP_BUILD_WEBPMUX OFF CACHE BOOL "" FORCE)
set(WEBP_BUILD_EXTRAS OFF CACHE BOOL "" FORCE)
set(WEBP_BUILD_LIBWEBPMUX ON CACHE BOOL "" FORCE)
set(WEBP_BUILD_WEBP_JS OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
FetchContent_Declare(tonic_webp
  URL https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.6.0.tar.gz
  URL_HASH SHA256=e4ab7009bf0629fd11982d4c2aa83964cf244cffba7347ecd39019a9e38c4564)
FetchContent_MakeAvailable(tonic_webp)
set(BUILD_DIR ${CMAKE_SOURCE_DIR}/build)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 17)

set(FILAMENT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/libs/filament")
set(BULLET3_DIR "${CMAKE_CURRENT_SOURCE_DIR}/libs/bullet3")

if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    add_definitions(-DDEBUG=1)
endif()

if(RNF_ENABLE_LOGS)
    add_definitions(-DRNF_ENABLE_LOGS=1)
else()
    add_definitions(-DRNF_ENABLE_LOGS=0)
endif()

# Third party libraries (Prefabs)
find_package(ReactAndroid REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)
find_library(LOG_LIB log)

# Add react-native-filament sources
add_library(
    ${PACKAGE_NAME}
    SHARED

    # Shared C++
    ../cpp/RNFFilamentView.cpp
    ../cpp/RNFFilamentProxy.cpp
    ../cpp/RNFFilamentRecorder.cpp
    ../cpp/RNFSurface.cpp
    ../cpp/RNFSurfaceProvider.cpp
    ../cpp/RNFChoreographer.cpp
    ../cpp/RNFChoreographerWrapper.cpp
    ../cpp/RNFListener.cpp
    ../cpp/jsi/RNFHybridObject.cpp
    ../cpp/jsi/RNFPromise.cpp
    ../cpp/jsi/RNFPromiseFactory.cpp
    ../cpp/jsi/RNFRuntimeCache.cpp
    ../cpp/jsi/RNFWorkletRuntimeRegistry.cpp
    ../cpp/threading/RNFDispatcher.cpp
    ../cpp/test/RNFTestHybridObject.cpp

    # Filament Core
    ../cpp/core/RNFEngineImpl.cpp
    ../cpp/core/RNFEngineImpl.Skybox.cpp
    ../cpp/core/RNFEngineWrapper.cpp
    ../cpp/core/RNFEngineConfigHelper.cpp
    ../cpp/core/RNFSceneWrapper.cpp
    ../cpp/core/RNFCameraWrapper.cpp
    ../cpp/core/RNFViewWrapper.cpp
    ../cpp/core/RNFSwapChainWrapper.cpp
    ../cpp/core/RNFFilamentAssetWrapper.cpp
    ../cpp/core/RNFAnimatorWrapper.cpp
    ../cpp/core/RNFTransformManagerImpl.cpp
    ../cpp/core/RNFTransformManagerWrapper.cpp
    ../cpp/core/RNFAABBWrapper.cpp
    ../cpp/core/RNFBoxWrapper.cpp
    ../cpp/core/RNFMaterialInstanceWrapper.cpp
    ../cpp/core/RNFNameComponentManagerWrapper.cpp
    ../cpp/core/RNFRenderableManagerImpl.cpp
    ../cpp/core/RNFRenderableManagerImpl.DebugHelpers.cpp
    ../cpp/core/RNFRenderableManagerWrapper.cpp
    ../cpp/core/RNFMaterialImpl.cpp
    ../cpp/core/RNFMaterialWrapper.cpp
    ../cpp/core/RNFFilamentInstanceWrapper.cpp
    ../cpp/core/RNFLightManagerWrapper.cpp
    ../cpp/core/RNFRendererWrapper.cpp
    ../cpp/core/RNFWebPExport.cpp
    ../cpp/core/RNFWebpTextureProvider.cpp

    # Filament Utils
    ../cpp/core/utils/RNFEntityWrapper.cpp
    ../cpp/core/utils/RNFManipulatorWrapper.cpp

    # Filament math
    ../cpp/core/math/RNFTMat44Wrapper.cpp

    # Bullet Physics Engine
    ../cpp/bullet/RNFBulletWrapper.cpp
    ../cpp/bullet/RNFDiscreteDynamicWorldWrapper.cpp
    ../cpp/bullet/RNFRigidBodyWrapper.cpp
    ../cpp/bullet/RNFShapeWrapper.cpp

    # Java JNI
    src/main/cpp/RNFAndroidFilamentProxy.cpp
    src/main/cpp/RNFAndroidSurface.cpp
    src/main/cpp/RNFFilament.cpp
    src/main/cpp/RNFAndroidLogger.cpp
    src/main/cpp/RNFJNISharedPtr.cpp
    src/main/cpp/RNFFilamentInstaller.cpp
    src/main/cpp/java-bindings/RNFJFilamentProxy.cpp
    src/main/cpp/java-bindings/RNFJFilamentRecorder.cpp
    src/main/cpp/java-bindings/RNFJChoreographer.cpp
    src/main/cpp/java-bindings/RNFJFilamentView.cpp
    src/main/cpp/java-bindings/RNFJDispatcher.cpp
    src/main/cpp/java-bindings/RNFJSurfaceProvider.cpp
)

# Header Search Paths (includes)
target_include_directories(
    ${PACKAGE_NAME}
    PRIVATE
    "../cpp"
    "src/main/cpp"
    "src/main/cpp/java-bindings"
    "${NODE_MODULES_DIR}/react-native/ReactCommon"
    "${NODE_MODULES_DIR}/react-native/ReactCommon/callinvoker"
    "${NODE_MODULES_DIR}/react-native/ReactAndroid/src/main/jni/react/turbomodule" # <-- CallInvokerHolder JNI wrapper
    "${FILAMENT_DIR}/include"
    "${BULLET3_DIR}/include"
    "${CMAKE_CURRENT_SOURCE_DIR}/../../filament/filament/backend/include" # <-- Filament backend private headers (dev)
    "${FILAMENT_DIR}/include/private" # <-- Filament private headers (distributed package)
)

# Link everything together
target_link_libraries(
    ${PACKAGE_NAME}
    ${LOG_LIB} # <-- Logcat logger
    android # <-- Android JNI core
    ReactAndroid::jsi # <-- RN: JSI
    fbjni::fbjni # <-- fbjni
    GLESv3 # <-- OpenGL (Core)
    EGL # <-- OpenGL (EGL)
)

# This if-then-else can be removed once this library does not support version below 0.76
if(ReactAndroid_VERSION_MINOR GREATER_EQUAL 76)
    message("RN Filament: Using React Native merged SO...")
    target_link_libraries(
        ${PACKAGE_NAME}
        ReactAndroid::reactnative
    )
else()
    target_link_libraries(
        ${PACKAGE_NAME}
        ReactAndroid::reactnativejni # <-- RN: React Native JNI bindings
    )
endif()

# Link with RNWC:
target_link_libraries(${PACKAGE_NAME} libwebpmux webp)
target_include_directories(${PACKAGE_NAME} PRIVATE "${tonic_webp_SOURCE_DIR}/src")
target_link_options(${PACKAGE_NAME} PRIVATE "-Wl,--exclude-libs,libwebp.a:libwebpmux.a:libsharpyuv.a")
find_package(react-native-worklets-core REQUIRED CONFIG)
message("RN Filament: react-native-worklets core found! Enabling Worklets support...")
message("RN Filament: react-native-worklets-core found in ${react-native-worklets-core_DIR}")
target_link_libraries(
    ${PACKAGE_NAME}
    react-native-worklets-core::rnworklets
)
add_definitions(-DHAS_WORKLETS=1)

# Filament (local CMake project as a git submodule)
message("RN Filament: Adding pre-compiled libraries in ${FILAMENT_DIR}...")
file(GLOB FILAMENT_LIBRARIES "${FILAMENT_DIR}/lib/${ANDROID_ABI}/*.a")

foreach(file ${FILAMENT_LIBRARIES})
    message("RN Filament: Linking ${file}...")
    target_link_libraries(${PACKAGE_NAME} ${file})
endforeach()

# Bullet3 (local CMake project as a git submodule)
message("RN Filament: Adding pre-compiled libraries in ${BULLET3_DIR}...")
file(GLOB BULLET3_LIBRARIES "${BULLET3_DIR}/lib/${ANDROID_ABI}/*.a")

foreach(file ${BULLET3_LIBRARIES})
    message("RN Filament: Linking ${file}...")
    target_link_libraries(${PACKAGE_NAME} ${file})
endforeach()

if(DEFINED CMAKE_ANDROID_NDK_VERSION AND CMAKE_ANDROID_NDK_VERSION VERSION_LESS "27")
  if(CMAKE_VERSION VERSION_LESS "3.13")
    # Old CMake fallback
    set_property(TARGET ${PACKAGE_NAME} APPEND PROPERTY
      LINK_FLAGS "-Wl,-z,max-page-size=16384")
  else()
    # Modern CMake
    target_link_options(${PACKAGE_NAME} PRIVATE "-Wl,-z,max-page-size=16384")
  endif()
endif()
