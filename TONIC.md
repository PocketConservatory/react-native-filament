# Tonic fork

This fork starts at upstream `v1.11.0` (`0bcf5076a130d04273aa3d57ebe2da6e34c6071a`). It carries Tonic's material assignment and ownership API, material ABI detection, Android JNI/GC safety changes, and offscreen animated WebP export with parallel frame encoding. It bundles Google Filament **1.77.3** (commit `d852e34cd5629a6f3851d613dcd17aa0ffd025a2`, material version 77) instead of upstream's engine (material version 68), with the wrapper's multi-instance Animator extension (`package/filament_animator_feat.patch`) applied on both platforms. The package keeps the name `react-native-filament` so existing imports, autolinking, and native module names remain compatible.

WebP export uses a dedicated engine and worklet context. Its native wrappers link libwebp 1.6.0: CocoaPods resolves it on iOS, while Android CMake downloads and verifies the pinned source archive before compiling it. Consuming applications must rebuild their native binaries to use these APIs.

## Building the engine

Git tracks the engine headers (`package/{android,ios}/libs/filament/include`) but not its libraries.
`tools/filament-engine/build.py` builds both from a pinned source checkout outside this repository:

```sh
git clone --branch v1.77.3 --depth 1 https://github.com/google/filament.git /path/to/cache/filament
python3 tools/filament-engine/build.py android --source /path/to/cache/filament \
  --ndk /path/to/android-ndk-r29 --host-tools /path/to/filament-v1.77.3-mac.tgz \
  --cmake-bin /path/to/android-sdk/cmake/3.22.1/bin --output /path/to/engine-android
python3 tools/filament-engine/build.py ios --source /path/to/another/filament-checkout \
  --cmake-bin /path/to/android-sdk/cmake/3.22.1/bin --output /path/to/engine-ios
```

Inputs: [Android NDK r29](https://dl.google.com/android/repository/android-ndk-r29-darwin.zip)
(`29.0.14206865`), Filament's [official 1.77.3 macOS host tools](https://github.com/google/filament/releases/download/v1.77.3/filament-v1.77.3-mac.tgz)
(SHA-256 verified by the script) for Android material compilation, CMake 3.22.1 with Ninja, and Xcode.
The script verifies the commit, applies the Animator patch and rejects any other source change.
Android builds `arm64-v8a`, `armeabi-v7a`, `x86` and `x86_64`; iOS runs Filament's own release build
(`build.sh -i -p ios -s -l release`, the flags of Google's iOS release workflow) for device arm64 and
simulator arm64/x86_64 XCFrameworks. Use separate source checkouts per platform (or build sequentially).
Each output `filament/` tree ships the same library set as upstream 1.11.0 and a `tonic-engine.json`
recording the inputs and the SHA-256 of every file. Replace the tracked `include` trees with the
built ones whenever the engine changes; the release builder requires them to be identical.

## Packaging a release

Use Node 22 and npm 11. Commit the reviewed source and release tool changes, then run:

```sh
node tools/package-release/build.mjs /tmp/tonic-filament-release \
  --android-engine /path/to/engine-android/filament --ios-engine /path/to/engine-ios/filament
```

The builder downloads the official `react-native-filament@1.11.0` npm tarball, verifies its pinned SHA-512 integrity, replaces its bundled Filament with the verified engine trees, overlays tracked fork package files, regenerates JavaScript and declarations with Bob using locked tool dependencies, and creates an npm-compatible tarball plus SHA-256 sidecar. It never copies an application's installed package. bullet3 libraries come unchanged from the upstream release; C++/Java/Objective-C wrapper changes compile in the consuming app.

The tarball contains `TONIC-PROVENANCE.json` recording the upstream archive, the fork commit and each engine's build record (its full file manifest ships as `{android,ios}/libs/filament/tonic-engine.json`). The builder rejects a dirty checkout by default. Use `--allow-dirty` only for pre-commit review and rebuild after committing; release only a build with `dirty: false`. No timestamp is written into provenance. The builder rejects an engine whose files differ from its manifest, that was not built from the pinned commit with the tracked Animator patch, or whose headers differ from the tracked headers, and verifies the packed native files after packing.

Create tag `v1.11.0-tonic.6` at the packaged commit and upload `react-native-filament-1.11.0-tonic.6.tgz` and its `.sha256` file as GitHub release assets. Point the app dependency at that exact release asset URL and commit its Yarn lockfile checksum. Never replace an existing release asset: increment the Tonic version and publish a new release for every change.

Do not use a direct Git dependency: upstream tracks neither native static libraries nor generated JavaScript. Its prepare hook requires the larger Bun/submodule development workspace. The release tarball contains everything the app needs and requires no install-time native build scripts.

## Apple file loader regression test

On macOS, compile `tools/tests/apple-file-loader.mm` with `xcrun clang++`, C++17, ARC, and the Foundation framework, then run the resulting executable. It exercises the production file loader against real file URLs containing spaces, Unicode, and literal percent escapes, plus ordinary and missing files.

## Maintenance

Submit generally useful fixes upstream as separate changes. On an upstream upgrade, compare the fork commits against the new release, remove merged fixes, update the pinned npm version and integrity in the builder, and rerun Android/iOS app validation. On a Filament upgrade, update the pinned commit in `tools/filament-engine/build.py` and the release builder, port the Animator patch, bump the `filament` submodule, rebuild both engines and replace the tracked headers. Applications must ship materials compiled for the bundled material version.
