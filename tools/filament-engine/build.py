#!/usr/bin/env python3
"""Build the bundled Filament engine for one platform from the pinned Google Filament source.

The output directory receives `filament/` with the headers, the release library set the package
ships and `tonic-engine.json`, which records the inputs and the SHA-256 of every output file.
The release builder copies that tree into the package and verifies it against the manifest.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

FILAMENT_VERSION = "1.77.3"
COMMIT = "d852e34cd5629a6f3851d613dcd17aa0ffd025a2"
MATERIAL_VERSION = 77
NDK_VERSION = "29.0.14206865"
HOST_TOOLS_SHA256 = "c1ef146a7efa504fcdc3aa06aa2db9b2f89d91436fcb87f2b4c15c95862ffeb8"
ROOT = Path(__file__).resolve().parents[2]
PATCH = ROOT / "package/filament_animator_feat.patch"
# Xcode 27's libc++ rejects Filament's iOS 11 / simulator 13 minimums; React Native requires 15.1.
IOS_DEPLOYMENT_PATCH = Path(__file__).with_name("ios-deployment-target.patch")
IOS_DEPLOYMENT_TARGET = "15.1"

# Android ABI -> Filament toolchain file suffix.
ANDROID_ABIS = {
    "arm64-v8a": "aarch64",
    "armeabi-v7a": "arm7",
    "x86": "x86",
    "x86_64": "x86_64",
}
# The library set react-native-filament 1.11.0 ships. Filament's Android install also produces
# desktop sample libraries (assimp, filamentapp, imagediff, imageio-lite) that the package omits.
ANDROID_LIBRARIES = sorted(f"lib{name}.a" for name in (
    "abseil", "backend", "basis_transcoder", "bluevk", "camutils", "civetweb", "dracodec",
    "filabridge", "filaflat", "filamat", "filament-generatePrefilterMipmap",
    "filament-iblprefilter", "filament", "filameshio", "geometry", "gltfio_core", "ibl-lite",
    "ibl", "image", "ktxreader", "meshoptimizer", "mikktspace", "perfetto", "shaders",
    "smol-v", "stb", "uberarchive", "uberzlib", "utils", "viewer", "zstd",
))
IOS_LIBRARIES = sorted(f"lib{name}.xcframework" for name in (
    "abseil", "backend", "basis_transcoder", "camutils", "civetweb", "dracodec", "filabridge",
    "filaflat", "filament-generatePrefilterMipmap", "filament-iblprefilter", "filament",
    "filameshio", "geometry", "gltfio_core", "ibl-lite", "ibl", "image", "ktxreader",
    "meshoptimizer", "mikktspace", "perfetto", "shaders", "smol-v", "stb", "uberarchive",
    "uberzlib", "utils", "viewer", "zstd",
))


def run(*command, **kwargs):
    """Run a build step, stopping immediately on failure."""
    subprocess.run([str(part) for part in command], check=True, **kwargs)


def output_of(*command):
    """Return a command's standard output."""
    return subprocess.check_output([str(part) for part in command], text=True).strip()


def prepare_source(source, patches):
    """Verify the pinned commit and leave exactly `patches` applied."""
    if output_of("git", "-C", source, "rev-parse", "HEAD") != COMMIT:
        raise SystemExit(f"Expected Google Filament v{FILAMENT_VERSION} commit {COMMIT}")
    for patch in patches:
        applied = subprocess.run(
            ["git", "-C", str(source), "apply", "--reverse", "--check", str(patch)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        ).returncode == 0
        if not applied:
            run("git", "-C", source, "apply", patch)
    diff = output_of("git", "-C", source, "diff", "--no-ext-diff", "--no-color", "--abbrev=8",
                     "--diff-algorithm=myers", "--no-renames", "--unified=3",
                     "--src-prefix=a/", "--dst-prefix=b/", "HEAD")
    # git diff lists files in path order, which is the order of `patches`.
    if diff != "\n".join(patch.read_text().strip() for patch in patches):
        raise SystemExit("Filament source has changes beyond the expected patches")
    if output_of("git", "-C", source, "ls-files", "--others", "--exclude-standard"):
        raise SystemExit("Filament source contains untracked files outside ignored build output")


def sha256(path):
    """Hash a file."""
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def assemble(install, output, platform, libraries, library_dirs, inputs):
    """Copy headers and the shipped library set into a fresh tree and write its manifest."""
    engine = output / "filament"
    if engine.exists():
        raise SystemExit(f"Output already exists; engine trees are never overwritten: {engine}")
    shutil.copytree(install / "include", engine / "include", symlinks=False)
    header = (engine / "include/filament/MaterialEnums.h").read_text()
    if f"MATERIAL_VERSION = {MATERIAL_VERSION};" not in header:
        raise SystemExit(f"Built headers are not material version {MATERIAL_VERSION}")
    if platform == "ios":
        # CocoaPods flattens public headers; gltfio's math.h would otherwise shadow the system one.
        (engine / "include/gltfio/math.h").rename(engine / "include/gltfio/gltfio-math.h")
    private = engine / "include/private/backend"
    private.mkdir(parents=True)
    shutil.copy2(inputs["source"] / "filament/backend/include/private/backend/VirtualMachineEnv.h", private)
    dropped = set()
    for directory in library_dirs:
        built = {entry.name for entry in (install / "lib" / directory).iterdir()}
        missing = sorted(set(libraries) - built)
        if missing:
            raise SystemExit(f"Build for {directory or platform} is missing {missing}")
        dropped |= built - set(libraries)
        for name in libraries:
            target = engine / "lib" / directory / name
            target.parent.mkdir(parents=True, exist_ok=True)
            copy = shutil.copytree if (install / "lib" / directory / name).is_dir() else shutil.copy2
            copy(install / "lib" / directory / name, target)
    files = {
        str(path.relative_to(engine)): sha256(path)
        for path in sorted(engine.rglob("*")) if path.is_file()
    }
    manifest = {
        "filament": FILAMENT_VERSION,
        "commit": COMMIT,
        "materialVersion": MATERIAL_VERSION,
        "platform": platform,
        "animatorPatchSha256": sha256(PATCH),
        **{key: value for key, value in inputs.items() if key != "source"},
        "omittedLibraries": sorted(dropped),
        "files": files,
    }
    (engine / "tonic-engine.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Engine ready: {engine} ({len(files)} files)")


def build_android(args):
    """Cross-compile every shipped ABI with the pinned NDK and official host tools."""
    ndk = args.ndk.resolve()
    if f"Pkg.Revision = {NDK_VERSION}" not in (ndk / "source.properties").read_text():
        raise SystemExit(f"Expected Android NDK {NDK_VERSION}")
    if sha256(args.host_tools) != HOST_TOOLS_SHA256:
        raise SystemExit("Host tools archive does not match the official Filament mac release")
    source = args.source.resolve()
    work = source / "out/tonic-android"
    host_tools = work / "host-tools"
    host_tools.mkdir(parents=True, exist_ok=True)
    run("tar", "-xzf", args.host_tools, "-C", host_tools)
    imports = work / "host"
    imports.mkdir(exist_ok=True)
    lines = []
    for name in ("matc", "cmgen", "filamesh", "mipgen", "resgen", "uberz", "glslminifier"):
        executable = host_tools / "filament/bin" / name
        if not executable.is_file():
            raise SystemExit(f"Missing host tool {executable}")
        lines += [f"if(NOT TARGET {name})", f"add_executable({name} IMPORTED GLOBAL)",
                  f'set_target_properties({name} PROPERTIES IMPORTED_LOCATION "{executable}")', "endif()"]
    (imports / "ImportExecutables-Release.cmake").write_text("\n".join(lines) + "\n")
    # Filament's toolchain files locate the NDK as $ANDROID_HOME/ndk/<version>.
    sdk_ndk = work / "sdk/ndk"
    sdk_ndk.mkdir(parents=True, exist_ok=True)
    link = sdk_ndk / NDK_VERSION
    if not link.exists():
        link.symlink_to(ndk, target_is_directory=True)
    environment = {**os.environ, "ANDROID_HOME": str(work / "sdk")}
    install = work / "install"
    cmake = args.cmake_bin.resolve()
    for abi, toolchain in ANDROID_ABIS.items():
        build = work / f"build-{abi}"
        run(cmake / "cmake", "-S", source, "-B", build, "-G", "Ninja",
            f"-DCMAKE_MAKE_PROGRAM={cmake / 'ninja'}", "-DCMAKE_BUILD_TYPE=Release",
            f"-DCMAKE_TOOLCHAIN_FILE={source / f'build/toolchain-{toolchain}-linux-android.cmake'}",
            f"-DFILAMENT_NDK_VERSION={NDK_VERSION}", f"-DIMPORT_EXECUTABLES_DIR={imports.relative_to(source)}",
            f"-DCMAKE_INSTALL_PREFIX={install}", "-DFILAMENT_SUPPORTS_VULKAN=ON",
            "-DFILAMENT_BUILD_FILAMAT=ON", env=environment)
        run(cmake / "cmake", "--build", build, "--target", "install", "--parallel", args.jobs,
            env=environment)
    assemble(install, args.output.resolve(), "android", ANDROID_LIBRARIES, list(ANDROID_ABIS), {
        "source": source, "ndk": NDK_VERSION, "hostToolsSha256": HOST_TOOLS_SHA256,
        "abis": list(ANDROID_ABIS),
    })


def build_ios(args):
    """Run Filament's own iOS release build (device arm64, simulator arm64 + x86_64 XCFrameworks)."""
    source = args.source.resolve()
    environment = {**os.environ, "PATH": f"{args.cmake_bin.resolve()}{os.pathsep}{os.environ['PATH']}"}
    # The same flags as Filament's release workflow (build/ios/build.sh release), installing
    # instead of archiving. Host tools are built from this source by the split build.
    run("./build.sh", "-i", "-p", "ios", "-s", "-l", "release", cwd=source, env=environment)
    xcode = output_of("xcodebuild", "-version").replace("\n", " ")
    assemble(source / "out/ios-release/filament", args.output.resolve(), "ios", IOS_LIBRARIES, [""], {
        "source": source, "xcode": xcode, "deploymentTarget": IOS_DEPLOYMENT_TARGET,
        "deploymentPatchSha256": sha256(IOS_DEPLOYMENT_PATCH),
        "slices": ["ios-arm64", "ios-arm64_x86_64-simulator"],
    })


def main():
    """Parse arguments and build the requested platform."""
    parser = argparse.ArgumentParser(description=__doc__)
    platforms = parser.add_subparsers(dest="platform", required=True)
    for name in ("android", "ios"):
        command = platforms.add_parser(name)
        command.add_argument("--source", type=Path, required=True, help="Filament v1.77.3 checkout")
        command.add_argument("--cmake-bin", type=Path, required=True,
                             help="Directory containing cmake >= 3.22.1 and ninja")
        command.add_argument("--output", type=Path, required=True, help="New output directory")
        if name == "android":
            command.add_argument("--ndk", type=Path, required=True)
            command.add_argument("--host-tools", type=Path, required=True,
                                 help="filament-v1.77.3-mac.tgz")
            command.add_argument("--jobs", type=int, default=8)
    args = parser.parse_args()
    patches = [PATCH] + ([IOS_DEPLOYMENT_PATCH] if args.platform == "ios" else [])
    prepare_source(args.source.resolve(), patches)
    (build_android if args.platform == "android" else build_ios)(args)


if __name__ == "__main__":
    main()
