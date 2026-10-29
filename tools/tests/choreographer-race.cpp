// Stress test for the Choreographer listener list under ThreadSanitizer. Links the real RNFChoreographer.cpp and
// RNFListener.cpp; only the platform start/stop is faked. See TONIC.md for the build command.

#include "RNFChoreographer.h"
#include "RNFLogger.h"

#include <atomic>
#include <chrono>
#include <cstdio>
#include <memory>
#include <mutex>
#include <random>
#include <thread>
#include <vector>

namespace margelo {
void Logger::log(const std::string&, const std::string&) {}
} // namespace margelo

using namespace margelo;

namespace {

class FakeChoreographer : public Choreographer {
public:
  void frame(double timestamp) {
    onFrame(timestamp);
  }

protected:
  void platformStart() override {}
  void platformStop() override {}
};

int failures = 0;

void expect(bool condition, const char* message) {
  if (!condition) {
    std::fprintf(stderr, "FAIL %s\n", message);
    failures++;
  }
}

void testNoFramesAfterStop() {
  FakeChoreographer choreographer;
  int calls = 0;
  auto listener = choreographer.addOnFrameListener([&](double) { calls++; });
  choreographer.frame(0);
  expect(calls == 0, "frames are delivered before start()");
  choreographer.start();
  choreographer.frame(1);
  expect(calls == 1, "frames are not delivered after start()");
  choreographer.stop();
  choreographer.frame(2);
  expect(calls == 1, "frames are delivered after stop()");
  choreographer.start();
  choreographer.start();
  choreographer.frame(3);
  expect(calls == 2, "start() is not idempotent");
  std::puts("PASS no frames after stop");
}

void testRemoveDuringFrame() {
  FakeChoreographer choreographer;
  choreographer.start();
  int calls = 0;
  std::shared_ptr<Listener> self;
  self = choreographer.addOnFrameListener([&](double) {
    calls++;
    self->remove();
  });
  auto other = choreographer.addOnFrameListener([&](double) { calls++; });
  choreographer.frame(0);
  choreographer.frame(1);
  expect(calls == 3, "removing a listener inside its own callback skips or repeats listeners");
  std::puts("PASS remove during frame");
}

void testRaces() {
  constexpr auto duration = std::chrono::seconds(2);
  auto choreographer = std::make_shared<FakeChoreographer>();
  choreographer->start();
  std::atomic_bool done = false;
  std::atomic_long frames = 0;
  std::atomic_long calls = 0;

  std::mutex listenersMutex;
  std::vector<std::shared_ptr<Listener>> listeners;

  std::thread frameThread([&] {
    double timestamp = 0;
    while (!done) {
      choreographer->frame(timestamp++);
      frames++;
    }
  });

  std::thread mutatorThread([&] {
    std::mt19937 random(42);
    while (!done) {
      switch (random() % 6) {
        case 0:
        case 1: {
          auto listener = choreographer->addOnFrameListener([&](double) { calls++; });
          std::unique_lock lock(listenersMutex);
          listeners.push_back(std::move(listener));
          break;
        }
        case 2: {
          std::unique_lock lock(listenersMutex);
          if (!listeners.empty()) {
            listeners[random() % listeners.size()]->remove();
          }
          break;
        }
        case 3:
          choreographer->removeAllListeners();
          break;
        case 4:
          choreographer->stop();
          break;
        case 5:
          choreographer->start();
          break;
      }
    }
  });

  // Destroys and removes listeners from a third thread, like a GC finalizer racing with JS.
  std::thread destroyerThread([&] {
    while (!done) {
      std::vector<std::shared_ptr<Listener>> dropped;
      {
        std::unique_lock lock(listenersMutex);
        if (listeners.size() > 8) {
          dropped.assign(listeners.begin(), listeners.begin() + 4);
          listeners.erase(listeners.begin(), listeners.begin() + 4);
        }
      }
      for (auto& listener : dropped) {
        listener->remove();
      }
      dropped.clear();
      std::this_thread::yield();
    }
  });

  std::this_thread::sleep_for(duration);
  done = true;
  frameThread.join();
  mutatorThread.join();
  destroyerThread.join();
  listeners.clear();
  expect(frames > 0, "no frames ran");
  std::printf("PASS races (%ld frames, %ld listener calls)\n", frames.load(), calls.load());
}

} // namespace

int main() {
  testNoFramesAfterStop();
  testRemoveDuringFrame();
  testRaces();
  if (failures > 0) {
    std::fprintf(stderr, "%d failure(s)\n", failures);
    return 1;
  }
  std::puts("All choreographer tests passed");
  return 0;
}
