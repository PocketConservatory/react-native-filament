# Tonic fork

This fork starts at upstream `v1.11.0` (`0bcf5076a130d04273aa3d57ebe2da6e34c6071a`). It carries Tonic's material assignment and ownership API, material ABI detection, optional custom Filament engine paths, Android JNI/GC safety changes, and offscreen animated WebP export with parallel frame encoding. The package keeps the name `react-native-filament` so existing imports, autolinking, and native module names remain compatible.

WebP export uses a dedicated engine and worklet context. Its native wrappers link libwebp 1.6.0: CocoaPods resolves it on iOS, while Android CMake downloads and verifies the pinned source archive before compiling it. Consuming applications must rebuild their native binaries to use these APIs.

## Packaging a release

Use Node 22 and npm 11. Commit the reviewed source and release tool changes, then run:

```sh
node tools/package-release/build.mjs /tmp/tonic-filament-release
```

The builder downloads the official `react-native-filament@1.11.0` npm tarball, verifies its pinned SHA-512 integrity, overlays tracked fork package files, regenerates JavaScript and declarations with Bob using locked tool dependencies, and creates an npm-compatible tarball plus SHA-256 sidecar. It never copies an application's installed package. Native libraries come unchanged from the verified upstream release; C++/Java/Objective-C wrapper changes compile in the consuming app.

The tarball contains `TONIC-PROVENANCE.json` recording the upstream archive and fork commit. The builder rejects a dirty checkout by default. Use `--allow-dirty` only for pre-commit review and rebuild after committing; release only a build with `dirty: false`. No timestamp is written into provenance. The builder also verifies that every bundled native library/header remains byte-identical to the published upstream package.

Create tag `v1.11.0-tonic.4` at the packaged commit and upload `react-native-filament-1.11.0-tonic.4.tgz` and its `.sha256` file as GitHub release assets. Point the app dependency at that exact release asset URL and commit its Yarn lockfile checksum. Never replace an existing release asset: increment the Tonic version and publish a new release for every change.

Do not use a direct Git dependency: upstream tracks neither native static libraries nor generated JavaScript. Its prepare hook requires the larger Bun/submodule development workspace. The release tarball contains everything the app needs and requires no install-time native build scripts.

## Apple file loader regression test

On macOS, compile `tools/tests/apple-file-loader.mm` with `xcrun clang++`, C++17, ARC, and the Foundation framework, then run the resulting executable. It exercises the production file loader against real file URLs containing spaces, Unicode, and literal percent escapes, plus ordinary and missing files.

## Maintenance

Submit generally useful fixes upstream as separate changes. On an upstream upgrade, compare the fork commits against the new release, remove merged fixes, update the pinned npm version and integrity in the builder, and rerun Android/iOS app validation. Keep custom-engine paths separate from the portable fixes. The optional custom engine remains an application-managed input; this release does not bundle it.
