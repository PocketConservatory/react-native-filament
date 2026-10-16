//
// Created by Hanno Gödecke on 24.04.24.
//

#pragma once

#include "RNFSwapChainWrapper.h"
#include "RNFViewWrapper.h"
#include "RNFWebPExport.h"
#include "jsi/RNFPointerHolder.h"
#include <filament/Renderer.h>

namespace margelo {

using namespace filament;

class RendererWrapper : public PointerHolder<Renderer> {
public:
  explicit RendererWrapper(std::shared_ptr<Renderer> renderer) : PointerHolder("RendererWrapper", renderer) {}

  void loadHybridMethods() override;

private: // Exposed JS API
  std::shared_ptr<WebPExport> _webpExport;
  int getWebPExportMaxPendingFrames();
  int getWebPExportPeakEncodingConcurrency();
  void beginParallelWebPExport(std::string path, int width, int height, int maxFrames);
  void beginResizedParallelWebPExport(std::string path, int captureWidth, int captureHeight, int outputWidth, int outputHeight,
                                      int maxFrames);
  void beginWebPExport(std::string path, int width, int height, int maxFrames);
  std::future<void> captureWebPFrame(int timestampMs);
  std::future<std::string> finishWebPExport(int timestampMs);
  void cancelWebPExport();
  void setFrameRateOptions(std::unordered_map<std::string, double> options);
  void setPresentationTime(double timestamp);

  /**
   * Whether the SwapChain should be cleared using the clearColor. Use this if translucent
   * View will be drawn, for instance.
   * @default true
   */
  void setClearContent(bool shouldClear);

  bool beginFrame(std::shared_ptr<SwapChainWrapper> swapChainWrapper, double timestamp);
  void render(std::shared_ptr<ViewWrapper> viewWrapper);
  void endFrame();
};

} // namespace margelo
