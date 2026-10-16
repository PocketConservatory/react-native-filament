//
// Created by Hanno Gödecke on 24.04.24.
//

#include "RNFRendererWrapper.h"
#include <backend/PixelBufferDescriptor.h>
#include <thread>

namespace margelo {
void RendererWrapper::loadHybridMethods() {
  registerHybridMethod("getWebPExportMaxPendingFrames", &RendererWrapper::getWebPExportMaxPendingFrames, this);
  registerHybridMethod("getWebPExportPeakEncodingConcurrency", &RendererWrapper::getWebPExportPeakEncodingConcurrency, this);
  registerHybridMethod("beginParallelWebPExport", &RendererWrapper::beginParallelWebPExport, this);
  registerHybridMethod("beginResizedParallelWebPExport", &RendererWrapper::beginResizedParallelWebPExport, this);
  registerHybridMethod("beginWebPExport", &RendererWrapper::beginWebPExport, this);
  registerHybridMethod("captureWebPFrame", &RendererWrapper::captureWebPFrame, this);
  registerHybridMethod("finishWebPExport", &RendererWrapper::finishWebPExport, this);
  registerHybridMethod("cancelWebPExport", &RendererWrapper::cancelWebPExport, this);
  registerHybridMethod("setFrameRateOptions", &RendererWrapper::setFrameRateOptions, this);
  registerHybridMethod("setClearContent", &RendererWrapper::setClearContent, this);
  registerHybridMethod("setPresentationTime", &RendererWrapper::setPresentationTime, this);
  registerHybridMethod("beginFrame", &RendererWrapper::beginFrame, this);
  registerHybridMethod("render", &RendererWrapper::render, this);
  registerHybridMethod("endFrame", &RendererWrapper::endFrame, this);
}

void RendererWrapper::setFrameRateOptions(std::unordered_map<std::string, double> options) {
  Renderer::FrameRateOptions frameRateOptions;
  if (options.find("interval") != options.end()) {
    frameRateOptions.interval = static_cast<uint8_t>(options["interval"]);
  }
  if (options.find("history") != options.end()) {
    frameRateOptions.history = static_cast<uint8_t>(options["history"]);
  }
  if (options.find("scaleRate") != options.end()) {
    frameRateOptions.scaleRate = static_cast<float>(options["scaleRate"]);
  }
  if (options.find("headRoomRatio") != options.end()) {
    frameRateOptions.headRoomRatio = static_cast<float>(options["headRoomRatio"]);
  }
  pointee()->setFrameRateOptions(frameRateOptions);
}

void RendererWrapper::setClearContent(bool shouldClear) {
  pointee()->setClearOptions({.clear = shouldClear});
}

void RendererWrapper::setPresentationTime(double timestamp) {
  int64_t timestampNs = static_cast<int64_t>(timestamp * 1'000) * 1'000;
  pointee()->setPresentationTime(timestampNs);
}

bool RendererWrapper::beginFrame(std::shared_ptr<SwapChainWrapper> swapChainWrapper, double timestamp) {
  std::shared_ptr<SwapChain> swapChain = swapChainWrapper->getSwapChain();
  return pointee()->beginFrame(swapChain.get(), timestamp);
}

void RendererWrapper::render(std::shared_ptr<ViewWrapper> viewWrapper) {
  std::shared_ptr<View> view = viewWrapper->getView();
  pointee()->render(view.get());
}

void RendererWrapper::endFrame() {
  pointee()->endFrame();
}

void RendererWrapper::beginWebPExport(std::string path, int width, int height, int maxFrames) {
  cancelWebPExport();
  _webpExport = std::make_shared<WebPExport>(path, width, height, maxFrames);
  pointee()->setClearOptions({.clearColor = {0, 0, 0, 0}, .clear = true});
}

void RendererWrapper::cancelWebPExport() {
  if (_webpExport)
    _webpExport->cancel();
  _webpExport.reset();
}

void RendererWrapper::beginParallelWebPExport(std::string path, int width, int height, int maxFrames) {
  cancelWebPExport();
  _webpExport = std::make_shared<WebPExport>(path, width, height, maxFrames, true);
  pointee()->setClearOptions({.clearColor = {0, 0, 0, 0}, .clear = true});
}

void RendererWrapper::beginResizedParallelWebPExport(std::string path, int captureWidth, int captureHeight, int outputWidth,
                                                     int outputHeight, int maxFrames) {
  cancelWebPExport();
  _webpExport = std::make_shared<WebPExport>(path, captureWidth, captureHeight, outputWidth, outputHeight, maxFrames);
  pointee()->setClearOptions({.clearColor = {0, 0, 0, 0}, .clear = true});
}

int RendererWrapper::getWebPExportPeakEncodingConcurrency() {
  return _webpExport ? _webpExport->peakEncodingConcurrency() : 0;
}

int RendererWrapper::getWebPExportMaxPendingFrames() {
  return WebPExport::maxPendingFrames;
}

std::future<void> RendererWrapper::captureWebPFrame(int timestampMs) {
  auto session = _webpExport;
  if (!session)
    throw std::runtime_error("WebP capture requires an active session");
  struct Readback {
    std::shared_ptr<WebPExport> session;
    std::shared_ptr<Renderer> renderer;
    std::shared_ptr<WebPExport::Frame> frame;
  };
  auto job = std::make_unique<Readback>();
  job->session = session;
  job->renderer = pointee();
  job->frame = session->reserveFrame(timestampMs);
  auto future = job->frame->promise.get_future();
  auto callback = [](void*, size_t, void* user) {
    auto owned = std::shared_ptr<Readback>(static_cast<Readback*>(user));
    // Never encode or wait for JS on Filament's completion thread.
    try {
      std::thread([job = owned]() { job->session->encodeFrame(job->frame); }).detach();
    } catch (...) {
      owned->session->cancel(std::current_exception());
    }
  };
  // Descriptor owns the job before submission, including a synchronous release callback.
  auto rawJob = job.release();
  backend::PixelBufferDescriptor buffer(rawJob->frame->pixels.data(), rawJob->frame->pixels.size(), backend::PixelDataFormat::RGBA,
                                        backend::PixelDataType::UBYTE, callback, rawJob);
  try {
    pointee()->readPixels(0, 0, session->width, session->height, std::move(buffer));
  } catch (...) {
    session->cancel(std::current_exception());
    throw;
  }
  return future;
}

std::future<std::string> RendererWrapper::finishWebPExport(int timestampMs) {
  auto session = _webpExport;
  if (!session)
    throw std::runtime_error("Cannot finish an inactive WebP export");
  session->seal();
  return std::async(std::launch::async, [session, timestampMs]() { return session->finish(timestampMs); });
}
} // namespace margelo
