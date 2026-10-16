#include "RNFWebPExport.h"
#if __has_include(<webp/encode.h>)
#include <webp/encode.h>
#include <webp/mux.h>
#else
#include <libwebp/encode.h>
#include <libwebp/mux.h>
#endif
#include <algorithm>
#include <cstdio>
#include <fstream>
#include <stdexcept>

namespace margelo {
WebPExport::WebPExport(std::string output, int w, int h, int maximum, bool independent)
    : width(w), height(h), maxFrames(maximum), path(std::move(output)), outputWidth(w), outputHeight(h), independentFrames(independent) {
  if (path.rfind("file://", 0) == 0)
    path.erase(0, 7);
  if (path.empty() || path.front() != '/' || w < 1 || h < 1 || w > 1024 || h > 1024 || maximum < 1 || maximum > 360)
    throw std::invalid_argument("WebP export requires an absolute path, dimensions 1..1024 and 1..360 frames");
  if (independentFrames) {
    mux = WebPMuxNew();
    if (!mux)
      throw std::runtime_error("Cannot allocate WebP mux");
    WebPMuxAnimParams params{0, 0};
    if (WebPMuxSetAnimationParams(mux, &params) != WEBP_MUX_OK || WebPMuxSetCanvasSize(mux, w, h) != WEBP_MUX_OK) {
      WebPMuxDelete(mux);
      mux = nullptr;
      throw std::runtime_error("Cannot configure WebP mux");
    }
    return;
  }
  WebPAnimEncoderOptions options;
  if (!WebPAnimEncoderOptionsInit(&options))
    throw std::runtime_error("WebP animation ABI mismatch");
  options.anim_params.loop_count = 0;
  encoder = WebPAnimEncoderNew(w, h, &options);
  if (!encoder)
    throw std::runtime_error("Cannot allocate WebP encoder");
}
WebPExport::WebPExport(std::string output, int captureWidth, int captureHeight, int targetWidth, int targetHeight, int maximum)
    : WebPExport(std::move(output), captureWidth, captureHeight, maximum, true) {
  if (targetWidth < 1 || targetHeight < 1 || targetWidth > captureWidth || targetHeight > captureHeight)
    throw std::invalid_argument("WebP output dimensions must be positive and no larger than capture dimensions");
  outputWidth = targetWidth;
  outputHeight = targetHeight;
  if (WebPMuxSetCanvasSize(mux, outputWidth, outputHeight) != WEBP_MUX_OK)
    throw std::runtime_error("Cannot configure resized WebP canvas");
}
WebPExport::~WebPExport() {
  if (encoder)
    WebPAnimEncoderDelete(encoder);
  if (mux)
    WebPMuxDelete(mux);
}

std::shared_ptr<WebPExport::Frame> WebPExport::reserveFrame(int timestampMs) {
  std::lock_guard lock(pendingMutex);
  if (cancelled || terminal)
    throw std::runtime_error("WebP export is inactive");
  if (pending.size() >= maxPendingFrames)
    throw std::runtime_error("WebP export already has eight pending frames");
  if (timestampMs < 0 || timestampMs > 30000 || timestampMs <= submittedTimestamp || submittedFrames >= maxFrames)
    throw std::invalid_argument("Invalid WebP frame timestamp or frame limit exceeded");
  auto frame = std::make_shared<Frame>();
  frame->sequence = submittedFrames;
  frame->timestamp = timestampMs;
  frame->pixels.resize(static_cast<size_t>(width) * height * 4);
  pending.emplace(frame->sequence, frame);
  ++submittedFrames;
  submittedTimestamp = timestampMs;
  return frame;
}

void WebPExport::cancel(std::exception_ptr failure) {
  if (!failure)
    failure = std::make_exception_ptr(std::runtime_error("WebP export cancelled"));
  {
    std::lock_guard lock(pendingMutex);
    cancelled = true;
    for (const auto& entry : pending)
      entry.second->promise.set_exception(failure);
    pending.clear();
  }
  pendingChanged.notify_all();
}

void WebPExport::encodeFrame(const std::shared_ptr<Frame>& frame) {
  try {
    std::vector<uint8_t> encoded;
    if (independentFrames) {
      encoded = encodeIndependent(*frame);
      std::vector<uint8_t>().swap(frame->pixels);
    }
    {
      std::unique_lock lock(pendingMutex);
      pendingChanged.wait(lock, [&] { return cancelled || frame->sequence == nextFrame; });
      if (cancelled)
        return;
    }
    if (independentFrames)
      appendIndependent(std::move(encoded), frame->timestamp);
    else
      encode(frame->pixels, frame->timestamp);
    std::vector<uint8_t>().swap(frame->pixels);
    {
      std::lock_guard lock(pendingMutex);
      if (cancelled)
        return;
      pending.erase(frame->sequence);
      ++nextFrame;
      frame->promise.set_value();
    }
    pendingChanged.notify_all();
  } catch (...) {
    cancel(std::current_exception());
  }
}

void WebPExport::seal() {
  std::lock_guard lock(pendingMutex);
  if (cancelled || terminal || !pending.empty())
    throw std::runtime_error("Cannot finish WebP export while inactive or a frame is pending");
  terminal = true;
}

std::vector<uint8_t> WebPExport::preparePixels(const std::vector<uint8_t>& rgba, bool firstFrame) const {
  if (cancelled)
    throw std::runtime_error("WebP export cancelled");
  if (rgba.size() != static_cast<size_t>(width) * height * 4)
    throw std::invalid_argument("Unexpected WebP input buffer size");
  // Preserve readback row order and convert premultiplied RGBA to straight alpha.
  std::vector<uint8_t> pixels(rgba.size());
  bool visible = false;
  for (int y = 0; y < height; ++y) {
    for (int x = 0; x < width; ++x) {
      size_t source = (static_cast<size_t>(y) * width + x) * 4;
      size_t target = (static_cast<size_t>(y) * width + x) * 4;
      unsigned alpha = rgba[source + 3];
      visible |= alpha > 0;
      pixels[target + 3] = alpha;
      for (int channel = 0; channel < 3; ++channel)
        pixels[target + channel] = alpha ? std::min(255u, (rgba[source + channel] * 255u + alpha / 2) / alpha) : 0;
    }
  }
  if (firstFrame && !visible)
    throw std::runtime_error("First WebP frame must contain visible pixels");
  return pixels;
}

void WebPExport::encode(const std::vector<uint8_t>& rgba, int timestampMs) {
  if (independentFrames)
    throw std::runtime_error("Independent encoding requires a reserved frame");
  if (timestampMs < 0 || timestampMs > 30000 || timestampMs <= lastTimestamp || frameCount >= maxFrames)
    throw std::invalid_argument("Invalid WebP frame timestamp or frame limit exceeded");
  auto pixels = preparePixels(rgba, frameCount == 0);
  WebPConfig config;
  if (!WebPConfigInit(&config))
    throw std::runtime_error("WebP encoder ABI mismatch");
  config.lossless = 1;
  config.quality = 70;
  config.method = 3;
  WebPPicture picture;
  if (!WebPPictureInit(&picture))
    throw std::runtime_error("WebP picture ABI mismatch");
  picture.use_argb = 1;
  picture.width = width;
  picture.height = height;
  bool imported = WebPPictureImportRGBA(&picture, pixels.data(), width * 4);
  bool added = imported && WebPAnimEncoderAdd(encoder, &picture, timestampMs, &config);
  std::string error = added ? "" : WebPAnimEncoderGetError(encoder);
  WebPPictureFree(&picture);
  if (!added)
    throw std::runtime_error("WebP frame encoding failed: " + error);
  lastTimestamp = timestampMs;
  ++frameCount;
}

std::vector<uint8_t> WebPExport::encodeIndependent(Frame& frame) {
  auto pixels = preparePixels(frame.pixels, frame.sequence == 0);
  std::vector<uint8_t>().swap(frame.pixels);
  WebPConfig config;
  if (!WebPConfigInit(&config))
    throw std::runtime_error("WebP encoder ABI mismatch");
  config.lossless = 1;
  config.quality = 70;
  config.method = 3;
  config.thread_level = 0;
  WebPPicture picture;
  if (!WebPPictureInit(&picture))
    throw std::runtime_error("WebP picture ABI mismatch");
  picture.use_argb = 1;
  picture.width = width;
  picture.height = height;
  WebPMemoryWriter writer;
  WebPMemoryWriterInit(&writer);
  picture.writer = WebPMemoryWrite;
  picture.custom_ptr = &writer;
  picture.user_data = this;
  picture.progress_hook = [](int, const WebPPicture* current) { return static_cast<WebPExport*>(current->user_data)->cancelled ? 0 : 1; };
  struct Cleanup {
    WebPPicture* picture;
    WebPMemoryWriter* writer;
    ~Cleanup() {
      WebPPictureFree(picture);
      WebPMemoryWriterClear(writer);
    }
  } cleanup{&picture, &writer};
  if (!WebPPictureImportRGBA(&picture, pixels.data(), width * 4))
    throw std::runtime_error("Cannot import independent WebP frame");
  std::vector<uint8_t>().swap(pixels);
  if (cancelled)
    throw std::runtime_error("WebP export cancelled");
  if ((outputWidth != width || outputHeight != height) && !WebPPictureRescale(&picture, outputWidth, outputHeight))
    throw std::runtime_error("Cannot resize independent WebP frame");
  if (cancelled)
    throw std::runtime_error("WebP export cancelled");
  int active = activeEncoders.fetch_add(1) + 1;
  int peak = peakEncoders.load();
  while (peak < active && !peakEncoders.compare_exchange_weak(peak, active)) {
  }
  bool encoded = WebPEncode(&config, &picture);
  activeEncoders.fetch_sub(1);
  if (!encoded)
    throw std::runtime_error("Independent WebP frame encoding failed: " + std::to_string(picture.error_code));
  if (cancelled)
    throw std::runtime_error("WebP export cancelled");
  return std::vector<uint8_t>(writer.mem, writer.mem + writer.size);
}

void WebPExport::pushPreviousFrame(int durationMs) {
  if (durationMs <= 0)
    throw std::invalid_argument("Invalid independent WebP frame duration");
  WebPMuxFrameInfo frame{};
  frame.bitstream = {previousEncodedFrame.data(), previousEncodedFrame.size()};
  frame.duration = durationMs;
  frame.id = WEBP_CHUNK_ANMF;
  frame.dispose_method = WEBP_MUX_DISPOSE_NONE;
  frame.blend_method = WEBP_MUX_NO_BLEND;
  if (WebPMuxPushFrame(mux, &frame, 1) != WEBP_MUX_OK)
    throw std::runtime_error("Cannot append independent WebP frame");
}

void WebPExport::appendIndependent(std::vector<uint8_t> encoded, int timestampMs) {
  if (cancelled)
    throw std::runtime_error("WebP export cancelled");
  if (frameCount)
    pushPreviousFrame(timestampMs - lastTimestamp);
  previousEncodedFrame = std::move(encoded);
  lastTimestamp = timestampMs;
  ++frameCount;
}

std::string WebPExport::finish(int timestampMs) {
  if (cancelled)
    throw std::runtime_error("WebP export cancelled");
  if (!frameCount || timestampMs <= lastTimestamp || timestampMs > 30000)
    throw std::invalid_argument("Invalid WebP end timestamp");
  WebPData data;
  WebPDataInit(&data);
  bool assembled;
  if (independentFrames) {
    pushPreviousFrame(timestampMs - lastTimestamp);
    std::vector<uint8_t>().swap(previousEncodedFrame);
    assembled = WebPMuxAssemble(mux, &data) == WEBP_MUX_OK;
  } else {
    assembled = WebPAnimEncoderAdd(encoder, nullptr, timestampMs, nullptr) && WebPAnimEncoderAssemble(encoder, &data);
  }
  if (!assembled) {
    std::string error = independentFrames ? "Cannot assemble independent WebP frames" : WebPAnimEncoderGetError(encoder);
    WebPDataClear(&data);
    throw std::runtime_error("WebP assembly failed: " + error);
  }
  const std::string temporary = path + ".partial";
  std::ofstream stream(temporary, std::ios::binary | std::ios::trunc);
  stream.write(reinterpret_cast<const char*>(data.bytes), data.size);
  stream.close();
  WebPDataClear(&data);
  if (!stream || cancelled || std::rename(temporary.c_str(), path.c_str()) != 0) {
    std::remove(temporary.c_str());
    throw std::runtime_error("Cannot publish WebP output (write failed or export cancelled)");
  }
  return "file://" + path;
}
} // namespace margelo
