//
// Created by Hanno Gödecke on 26.03.24.
//

#pragma once

#include "RNFAABBWrapper.h"
#include "RNFNameComponentManagerWrapper.h"
#include "jsi/RNFHybridObject.h"
#include "utils/RNFEntityWrapper.h"

#include <gltfio/FilamentAsset.h>
#include <gltfio/FilamentInstance.h>

#include <memory>
#include <stdexcept>

namespace margelo {

using namespace filament;
using namespace gltfio;

class AnimatorWrapper;

/**
 * Returns the asset a wrapper references without owning it. Holding only a weak reference means a JS object that
 * the GC has not collected yet cannot keep the asset, and through it the engine, alive after JS released the asset.
 * Throws the same error as using a released `FilamentAssetWrapper`.
 */
inline std::shared_ptr<gltfio::FilamentAsset> lockAsset(const std::weak_ptr<gltfio::FilamentAsset>& asset) {
  std::shared_ptr<gltfio::FilamentAsset> lockedAsset = asset.lock();
  if (lockedAsset == nullptr) {
    [[unlikely]];
    throw std::runtime_error("Pointer FilamentAssetWrapper has already been manually released!");
  }
  return lockedAsset;
}

class FilamentInstanceWrapper : public HybridObject {
public:
  /**
   * `instance` is owned by `asset`. Methods throw once the asset was released.
   */
  explicit FilamentInstanceWrapper(FilamentInstance* instance, std::shared_ptr<gltfio::FilamentAsset> asset)
      : HybridObject("FilamentInstanceWrapper"), _instance(instance), _asset(std::move(asset)) {}

  void loadHybridMethods() override;

  // Internal only
  FilamentInstance* getInstance() {
    return _instance;
  }

private: // Public JS API
  int getEntityCount();
  std::vector<std::shared_ptr<EntityWrapper>> getEntities();
  std::shared_ptr<EntityWrapper> getRoot();
  /**
   * Returns the animation engine for the instance.
   *
   * Note that an animator can be obtained either from an individual instance, or from the
   * originating FilamentAsset. In the latter case, the animation frame is shared amongst all
   * instances. If individual control is desired, users must obtain the animator from the
   * individual instances.
   */
  std::shared_ptr<AnimatorWrapper> createAnimator(std::shared_ptr<NameComponentManagerWrapper> nameComponentManager);
  std::shared_ptr<AABBWrapper> getBoundingBox();

private:
  FilamentInstance* _instance;
  std::weak_ptr<gltfio::FilamentAsset> _asset;
};
} // namespace margelo
