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

  // Plain bool: ThreadSanitizer reports platform calls that start()/stop() do not serialize.
  bool platformRunning = false;

protected:
  void platformStart() override {
    std::this_thread::yield();
    platformRunning = true;
  }
  void platformStop() override {
    std::this_thread::yield();
    platformRunning = false;
  }
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

void testAddDuringFrame() {
  FakeChoreographer choreographer;
  choreographer.start();
  int calls = 0;
  std::vector<std::shared_ptr<Listener>> added;
  auto adder = choreographer.addOnFrameListener([&](double) {
    if (added.empty()) {
      added.push_back(choreographer.addOnFrameListener([&](double) { calls++; }));
    }
  });
  choreographer.frame(0);
  calls = 0;
  choreographer.frame(1);
  expect(calls == 1, "a listener added inside a frame callback is not called on the next frame");
  std::puts("PASS add during frame");
}

// stop() from inside a frame races start()/stop() on another thread, as alpha's pause does (frame worklet and JS).
// Afterwards, frames must be delivered exactly when the platform is running.
void testStartStopRace() {
  constexpr int rounds = 300;
  constexpr int steps = 500;
  int mismatches = 0;
  for (int round = 0; round < rounds; round++) {
    FakeChoreographer choreographer;
    long calls = 0;
    auto counter = choreographer.addOnFrameListener([&](double) { calls++; });
    auto stopper = choreographer.addOnFrameListener([&](double timestamp) {
      if (static_cast<long>(timestamp) % 3 == 0) {
        choreographer.stop();
      }
    });
    choreographer.start();
    std::atomic_int ready = 0;
    auto waitForBoth = [&] {
      ready++;
      while (ready < 2) {
      }
    };
    std::thread frameThread([&] {
      waitForBoth();
      for (int i = 0; i < steps; i++) {
        choreographer.frame(i);
      }
    });
    std::thread toggleThread([&, round] {
      std::mt19937 random(round);
      waitForBoth();
      for (int i = 0; i < steps; i++) {
        if (random() % 2 == 0) {
          choreographer.start();
        } else {
          choreographer.stop();
        }
      }
    });
    frameThread.join();
    toggleThread.join();
    stopper->remove();
    long before = calls;
    choreographer.frame(1);
    bool delivered = calls > before;
    if (delivered != choreographer.platformRunning) {
      mismatches++;
    }
  }
  expect(mismatches == 0, "start()/stop() left the running flag and the platform out of step");
  std::printf("PASS start/stop race (%d/%d rounds out of step)\n", mismatches, rounds);
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

  // Only touched on the frame thread, by listeners that add a listener from inside a frame.
  std::vector<std::shared_ptr<Listener>> addedInFrame;
  auto addFromFrame = [&](double timestamp) {
    if (static_cast<long>(timestamp) % 16 == 0) {
      addedInFrame.push_back(choreographer->addOnFrameListener([&](double) { calls++; }));
      if (addedInFrame.size() > 32) {
        addedInFrame.clear();
      }
    }
  };

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
        case 0: {
          auto listener = choreographer->addOnFrameListener([&](double) { calls++; });
          std::unique_lock lock(listenersMutex);
          listeners.push_back(std::move(listener));
          break;
        }
        case 1: {
          // Adding here while a frame callback adds takes the same locks in the opposite order, unless
          // addOnFrameListener() releases the list pointer lock before adding.
          auto listener = choreographer->addOnFrameListener(addFromFrame);
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
  addedInFrame.clear();
  expect(frames > 0, "no frames ran");
  std::printf("PASS races (%ld frames, %ld listener calls)\n", frames.load(), calls.load());
}

} // namespace

int main() {
  testNoFramesAfterStop();
  testRemoveDuringFrame();
  testAddDuringFrame();
  testStartStopRace();
  testRaces();
  if (failures > 0) {
    std::fprintf(stderr, "%d failure(s)\n", failures);
    return 1;
  }
  std::puts("All choreographer tests passed");
  return 0;
}
