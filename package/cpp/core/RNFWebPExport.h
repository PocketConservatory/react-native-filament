#pragma once
#include <atomic>
#include <condition_variable>
#include <future>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>
struct WebPAnimEncoder;
struct WebPMux;

namespace margelo {
/** Owns an ordered export with at most eight outstanding readback/encode jobs. */
class WebPExport {
public:
  struct Frame {
    size_t sequence;
    int timestamp;
    std::vector<uint8_t> pixels;
    std::promise<void> promise;
  };
  static constexpr int maxPendingFrames = 8;
  WebPExport(std::string path, int width, int height, int maxFrames, bool independentFrames = false);
  /** Captures full-size pixels and independently encodes alpha-aware downscaled frames. */
  WebPExport(std::string path, int captureWidth, int captureHeight, int outputWidth, int outputHeight, int maxFrames);
  ~WebPExport();
  /** Reserves a bounded pixel buffer and submission position before GPU readback. */
  std::shared_ptr<Frame> reserveFrame(int timestampMs);
  /** Encodes a completed readback in submission order on a native worker. */
  void encodeFrame(const std::shared_ptr<Frame>& frame);
  /** Rejects outstanding jobs and wakes encoding workers without waiting for the GPU. */
  void cancel(std::exception_ptr failure = nullptr);
  /** Seals submission after all reserved jobs have finished. */
  void seal();
  /** Returns the observed peak number of concurrent independent WebPEncode calls. */
  int peakEncodingConcurrency() const {
    return peakEncoders.load();
  }
  void encode(const std::vector<uint8_t>& rgba, int timestampMs);
  std::string finish(int timestampMs);
  int width, height, maxFrames, frameCount = 0, lastTimestamp = -1;
  std::atomic<bool> cancelled{false}, terminal{false};

private:
  std::mutex pendingMutex;
  std::condition_variable pendingChanged;
  std::map<size_t, std::shared_ptr<Frame>> pending;
  size_t submittedFrames = 0, nextFrame = 0;
  int submittedTimestamp = -1;
  std::string path;
  int outputWidth, outputHeight;
  WebPAnimEncoder* encoder = nullptr;
  const bool independentFrames;
  WebPMux* mux = nullptr;
  std::vector<uint8_t> previousEncodedFrame;
  std::atomic<int> activeEncoders{0}, peakEncoders{0};
  std::vector<uint8_t> preparePixels(const std::vector<uint8_t>& rgba, bool firstFrame) const;
  std::vector<uint8_t> encodeIndependent(Frame& frame);
  void appendIndependent(std::vector<uint8_t> encoded, int timestampMs);
  void pushPreviousFrame(int durationMs);
};
} // namespace margelo
