require "json"
require "fileutils"


filament_path = "ios/libs/filament"
if ENV["TONIC_FILAMENT_IOS_DIR"] && !ENV["TONIC_FILAMENT_IOS_DIR"].empty?
  source = File.realpath(ENV["TONIC_FILAMENT_IOS_DIR"])
  expected_stamp = "filament=1.77.3\narchive-sha256=40bc8e5a51040cc4b0bf8aaff7bf339ce16e13485644f60dbe1cb023b284fde7\nmaterial-abi=77\n"
  stamp_path = File.join(source, "tonic-ios-release.txt")
  unless File.file?(stamp_path) && File.read(stamp_path) == expected_stamp
    raise "Prepare the official Filament 1.77.3 iOS archive with scripts/native-avatar/prepare-filament-ios.py first"
  end
  header = File.join(source, "include/filament/MaterialEnums.h")
  unless File.read(header).match?(/MATERIAL_VERSION = 77;/)
    raise "Custom Filament iOS headers must use material ABI 77"
  end
  filament_path = "ios/libs/filament-custom"
  destination = File.join(__dir__, filament_path)
  marker = File.join(destination, "tonic-copy-source.txt")
  copy_identity = source + "\n" + expected_stamp
  unless File.file?(marker) && File.read(marker) == copy_identity
    FileUtils.rm_rf(destination)
    FileUtils.cp_r(source, destination)
    File.write(marker, copy_identity)
  end
end

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# TODO: test if this change works well in regular RN projects - however, might not needed if i remove RNWC
workletsPath = File.dirname(`cd "#{Pod::Config.instance.installation_root.to_s}" && node --print "require.resolve('react-native-worklets-core/package.json')"`)
hasWorklets = File.exist?(workletsPath)
Pod::UI.puts("[react-native-filament] react-native-worklets-core #{hasWorklets ? "found" : "not found"}!")

# Logs are enabled by default, however they use NSLog and if you have a lot of logs it can slow down your app.
enableLogs = true
if defined?($RNFEnableLogs)
  Pod::UI.puts "[react-native-filament] $RNFEnableLogs is set to #{$RNFEnableLogs}!"
  enableLogs = $RNFEnableLogs
end

Pod::Spec.new do |s|
  s.name         = "react-native-filament"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :http => "https://github.com/PocketConservatory/react-native-filament/releases/download/v#{s.version}/react-native-filament-#{s.version}.tgz" }

  s.pod_target_xcconfig = {
    "GCC_PREPROCESSOR_DEFINITIONS" => "FILAMENT_APP_USE_METAL=1 HAS_WORKLETS=#{hasWorklets} RNF_ENABLE_LOGS=#{enableLogs} $(inherited)",
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++17",
    "HEADER_SEARCH_PATHS" => "\"$(PODS_TARGET_SRCROOT)/cpp/**\" \"$(PODS_TARGET_SRCROOT)/ios/libs/bullet3/**\" \"$(PODS_TARGET_SRCROOT)/#{filament_path}/include/**\""
  }

  # Configure sub podspecs for filament
  s.subspec "filament" do |ss|
    ss.source_files =
        "#{filament_path}/include/filament/*.h",
        "#{filament_path}/include/backend/*.h",
        "#{filament_path}/include/filament/MaterialChunkType.h",
        "#{filament_path}/include/filament/MaterialEnums.h",
        "#{filament_path}/include/ibl/*.h",
        "#{filament_path}/include/geometry/*.h"
    ss.header_mappings_dir = "#{filament_path}/include"
    engine_frameworks = [
        "#{filament_path}/lib/libfilament.xcframework",
        "#{filament_path}/lib/libbackend.xcframework",
        "#{filament_path}/lib/libfilabridge.xcframework",
        "#{filament_path}/lib/libfilaflat.xcframework",
        "#{filament_path}/lib/libibl.xcframework",
        "#{filament_path}/lib/libgeometry.xcframework"
    ]
    if filament_path != "ios/libs/filament"
      engine_frameworks += [
        "#{filament_path}/lib/libmeshoptimizer.xcframework",
        "#{filament_path}/lib/libmikktspace.xcframework"
      ]
    end
    ss.vendored_frameworks = engine_frameworks
    ss.dependency "react-native-filament/utils"
    ss.dependency "react-native-filament/math"
  end

  s.subspec "camutils" do |ss|
    ss.source_files = "#{filament_path}/include/camutils/*.h"
    ss.vendored_frameworks = "#{filament_path}/lib/libcamutils.xcframework"
    ss.header_dir = "camutils"
    ss.header_mappings_dir = "#{filament_path}/include"
    ss.dependency "react-native-filament/math"
  end

  s.subspec "utils" do |ss|
    ss.source_files = "#{filament_path}/include/utils/**/*.h"
    ss.header_mappings_dir = "#{filament_path}/include"
    ss.header_dir = "utils"
    ss.header_mappings_dir = "#{filament_path}/include"
    ss.vendored_frameworks = "#{filament_path}/lib/libutils.xcframework"
    ss.dependency "react-native-filament/tsl"
  end

  s.subspec "tsl" do |ss|
    ss.source_files = "#{filament_path}/include/tsl/*.h"
    ss.header_dir = "tsl"
  end

  s.subspec "math" do |ss|
    ss.source_files = "#{filament_path}/include/math/*.h"
    ss.header_dir = "math"
    ss.header_mappings_dir = "#{filament_path}/include"
  end

  s.subspec "filamat" do |ss|
    ss.source_files =
        "#{filament_path}/include/filamat/*.h",
        "#{filament_path}/include/filament/MaterialChunkType.h",
        "#{filament_path}/include/filament/MaterialEnums.h"
    ss.header_mappings_dir = "#{filament_path}/include"
    ss.vendored_frameworks =
      "#{filament_path}/lib/libfilamat.xcframework",
      "#{filament_path}/lib/libshaders.xcframework",
      "#{filament_path}/lib/libsmol-v.xcframework",
      "#{filament_path}/lib/libfilabridge.xcframework"
    ss.dependency "react-native-filament/utils"
    ss.dependency "react-native-filament/math"
  end

  s.subspec "image" do |ss|
    ss.source_files = "#{filament_path}/include/image/*.h"
    ss.vendored_frameworks = "#{filament_path}/lib/libimage.xcframework"
    ss.header_dir = "image"
    ss.dependency "react-native-filament/filament"
  end

  s.subspec "ktxreader" do |ss|
    ss.source_files = "#{filament_path}/include/ktxreader/*.h"
    ss.header_mappings_dir = "#{filament_path}/include"
    ss.vendored_frameworks =
        "#{filament_path}/lib/libktxreader.xcframework",
        "#{filament_path}/lib/libbasis_transcoder.xcframework"
    ss.dependency "react-native-filament/image"
    ss.dependency "react-native-filament/filament"
  end

  s.subspec "uberz" do |ss|
    ss.source_files = "#{filament_path}/include/uberz/*.h"
    ss.header_mappings_dir = "#{filament_path}/include"
    ss.vendored_frameworks =
        "#{filament_path}/lib/libuberzlib.xcframework",
        "#{filament_path}/lib/libzstd.xcframework"
    ss.header_dir = "uberz"
    ss.dependency "react-native-filament/filamat"
    ss.dependency "react-native-filament/tsl"
    ss.dependency "react-native-filament/utils"
  end

  s.subspec "gltfio_core" do |ss|
    ss.source_files = "#{filament_path}/include/gltfio/**/*.h"
    ss.header_mappings_dir = "#{filament_path}/include"
    ss.vendored_frameworks =
      "#{filament_path}/lib/libgltfio_core.xcframework",
      "#{filament_path}/lib/libdracodec.xcframework",
      "#{filament_path}/lib/libuberarchive.xcframework",
      "#{filament_path}/lib/libstb.xcframework"
    ss.dependency "react-native-filament/filament"
    ss.dependency "react-native-filament/ktxreader"
    ss.dependency "react-native-filament/uberz"
  end

  # All source files that should be publicly visible
  # Note how this does not include headers, since those can nameclash.
  s.source_files = [
    "cpp/**/*.{h,c,cpp}",
    "ios/src/**/*.{h,m,mm,cpp}",
    "ios/libs/bullet3/**/*.{h,c,cpp}"
  ]
  
  # Exclude bullet3 -all files to avoid duplicate symbols in building w/ dynamic frameworks
  s.exclude_files = [
    "ios/libs/bullet3/**/bt*All.{h,cpp}",
    "ios/libs/bullet3/**/btLinearMathAll.cpp",
    "ios/libs/bullet3/**/btBulletCollisionAll.cpp",
    "ios/libs/bullet3/**/btBulletDynamicsAll.cpp"
  ]

  # Any private headers that are not globally unique should be mentioned here.
  # Otherwise there will be a nameclash, since CocoaPods flattens out any header directories
  # See https://github.com/firebase/firebase-ios-sdk/issues/4035 for more details.
  s.preserve_paths = [
    "cpp/**/*.h",
    "ios/src/*.h"
  ]

  s.dependency "react-native-worklets-core"
  s.dependency "libwebp", "1.6.0"
  
  s.ios.frameworks = 'AVFoundation', 'CoreMedia'

  if defined?($RNFExcludeAssets) && $RNFExcludeAssets == true
    Pod::UI.puts "[react-native-filament] Excluding assets!"
  else
    s.resources = ["assets/*"]
  end

  # Use install_modules_dependencies helper to install the dependencies if React Native version >=0.71.0.
  # See https://github.com/facebook/react-native/blob/febf6b7f33fdb4904669f99d795eba4c0f95d7bf/scripts/cocoapods/new_architecture.rb#L79.
  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency "React-Core"

    # Don't install the dependencies when we run `pod install` in the old architecture.
    if ENV['RCT_NEW_ARCH_ENABLED'] == '1' then
      s.compiler_flags = folly_compiler_flags + " -DRCT_NEW_ARCH_ENABLED=1"
      s.pod_target_xcconfig    = {
          "HEADER_SEARCH_PATHS" => "\"$(PODS_TARGET_SRCROOT)/cpp/\"/** \"$(PODS_ROOT)/boost\"",
          "OTHER_CPLUSPLUSFLAGS" => "-DFOLLY_NO_CONFIG -DFOLLY_MOBILE=1 -DFOLLY_USE_LIBCPP=1",
          "CLANG_CXX_LANGUAGE_STANDARD" => "c++17"
      }
      s.dependency "React-RCTFabric"
      s.dependency "React-Codegen"
      s.dependency "RCT-Folly"
      s.dependency "RCTRequired"
      s.dependency "RCTTypeSafety"
      s.dependency "ReactCommon/turbomodule/core"
    end
  end
end
