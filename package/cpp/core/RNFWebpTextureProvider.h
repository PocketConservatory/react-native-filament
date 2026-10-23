#pragma once

#include <filament/Engine.h>
#include <gltfio/TextureProvider.h>

namespace margelo {
/**
 * Creates a gltfio texture provider that decodes `image/webp` glTF images with the libwebp the package already links.
 * The prebuilt Filament engine is built without FILAMENT_SUPPORTS_WEBP_TEXTURES, so gltfio's own createWebpProvider
 * returns nullptr. The caller owns the provider and deletes it after the ResourceLoader that uses it.
 */
filament::gltfio::TextureProvider* createWebpTextureProvider(filament::Engine* engine);
} // namespace margelo
