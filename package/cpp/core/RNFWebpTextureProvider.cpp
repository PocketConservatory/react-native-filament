#include "RNFWebpTextureProvider.h"

#include <filament/Texture.h>

#if __has_include(<webp/decode.h>)
#include <webp/decode.h>
#else
#include <libwebp/decode.h>
#endif

#include <chrono>
#include <future>
#include <memory>
#include <string>
#include <vector>

namespace margelo {

using filament::Engine;
using filament::Texture;
using filament::gltfio::TextureProvider;

namespace {

/**
 * Follows the gltfio TextureProvider contract the same way Filament's StbProvider does: pushTexture returns an
 * empty texture sized from the WebP header, decoding runs off the caller's thread, and updateQueue (called on the
 * ResourceLoader's thread) uploads the base level and generates mipmaps. Decoding uses std::async because the
 * prebuilt engine's public headers don't expose utils::JobSystem.
 */
class WebpTextureProvider final : public TextureProvider {
public:
  explicit WebpTextureProvider(Engine* engine) : _engine(engine) {}
  ~WebpTextureProvider() override {
    cancelDecoding();
  }

  Texture* pushTexture(const uint8_t* data, size_t byteCount, const char* /* mimeType */, TextureFlags flags) override {
    int width = 0;
    int height = 0;
    if (!WebPGetInfo(data, byteCount, &width, &height)) {
      _pushMessage = "Unable to parse webp texture";
      return nullptr;
    }

    using InternalFormat = Texture::InternalFormat;
    Texture* texture = Texture::Builder()
                           .width(width)
                           .height(height)
                           .levels(0xff)
                           .format(any(flags & TextureFlags::sRGB) ? InternalFormat::SRGB8_A8 : InternalFormat::RGBA8)
                           .usage(Texture::Usage::DEFAULT | Texture::Usage::GEN_MIPMAPPABLE)
                           .build(*_engine);
    if (texture == nullptr) {
      _pushMessage = "Unable to build Texture object for webp image";
      return nullptr;
    }

    _pushMessage.clear();
    auto pending = std::make_unique<PendingTexture>();
    pending->texture = texture;
    pending->texels = std::async(std::launch::async, [source = std::vector<uint8_t>(data, data + byteCount)] {
      int decodedWidth = 0;
      int decodedHeight = 0;
      return WebPDecodeRGBA(source.data(), source.size(), &decodedWidth, &decodedHeight);
    });
    _textures.push_back(std::move(pending));
    _pushedCount++;
    return texture;
  }

  Texture* popTexture() override {
    for (auto& pending : _textures) {
      if (pending->state == State::Ready) {
        pending->state = State::Popped;
        _poppedCount++;
        if (pending->failed) {
          _popMessage = "Texture is incomplete";
        } else {
          _popMessage.clear();
        }
        return pending->texture;
      }
    }
    return nullptr;
  }

  void updateQueue() override {
    for (auto& pending : _textures) {
      if (pending->state != State::Decoding ||
          pending->texels.wait_for(std::chrono::seconds(0)) != std::future_status::ready) {
        continue;
      }
      uint8_t* texels = pending->texels.get();
      pending->state = State::Ready;
      _decodedCount++;
      if (texels == nullptr) {
        pending->failed = true;
        continue;
      }
      Texture* texture = pending->texture;
      Texture::PixelBufferDescriptor buffer(texels, texture->getWidth() * texture->getHeight() * 4, Texture::Format::RGBA,
                                            Texture::Type::UBYTE, [](void* memory, size_t, void*) { WebPFree(memory); });
      texture->setImage(*_engine, 0, std::move(buffer));
      // The TextureProvider contract requires every provider to fill all mip levels.
      texture->generateMipmaps(*_engine);
    }

    // Textures become ready out of order; trimming popped entries from the front is enough to bound the list.
    auto firstUnpopped = _textures.begin();
    while (firstUnpopped != _textures.end() && (*firstUnpopped)->state == State::Popped) {
      ++firstUnpopped;
    }
    _textures.erase(_textures.begin(), firstUnpopped);
  }

  void waitForCompletion() override {
    for (auto& pending : _textures) {
      if (pending->state == State::Decoding) {
        pending->texels.wait();
      }
    }
  }

  void cancelDecoding() override {
    // A running decode can't be interrupted, so wait for it and free the result.
    for (auto& pending : _textures) {
      if (pending->state == State::Decoding) {
        if (uint8_t* texels = pending->texels.get()) {
          WebPFree(texels);
        }
        pending->state = State::Popped;
      }
    }
  }

  const char* getPushMessage() const override {
    return _pushMessage.empty() ? nullptr : _pushMessage.c_str();
  }
  const char* getPopMessage() const override {
    return _popMessage.empty() ? nullptr : _popMessage.c_str();
  }
  size_t getPushedCount() const override {
    return _pushedCount;
  }
  size_t getPoppedCount() const override {
    return _poppedCount;
  }
  size_t getDecodedCount() const override {
    return _decodedCount;
  }

private:
  enum class State { Decoding, Ready, Popped };

  struct PendingTexture {
    Texture* texture = nullptr;
    std::future<uint8_t*> texels;
    State state = State::Decoding;
    bool failed = false;
  };

  Engine* const _engine;
  std::vector<std::unique_ptr<PendingTexture>> _textures;
  std::string _pushMessage;
  std::string _popMessage;
  size_t _pushedCount = 0;
  size_t _poppedCount = 0;
  size_t _decodedCount = 0;
};

} // namespace

TextureProvider* createWebpTextureProvider(Engine* engine) {
  return new WebpTextureProvider(engine);
}

} // namespace margelo
