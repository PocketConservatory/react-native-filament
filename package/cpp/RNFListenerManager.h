//
// Created by Marc Rousavy on 24.02.24.
//

#pragma once

#include "RNFListener.h"
#include <algorithm>
#include <functional>
#include <list>
#include <memory>
#include <mutex>

namespace margelo {

template <typename Callback> class ListenerManager : public std::enable_shared_from_this<ListenerManager<Callback>> {
private:
  struct Entry {
    Callback callback;
    bool isRemoved = false;
  };
  std::list<Entry> _listeners;
  // recursive mutex allows listeners to be removed within their actual callback.
  std::recursive_mutex _mutex;
  // While forEach() runs, removed entries are only marked, so the loop's iterator stays valid. They are erased once
  // the outermost loop is done.
  size_t _iterationDepth = 0;
  bool _hasRemovedListeners = false;

public:
  /**
   * Add a listener to the list.
   * This method is thread-safe.
   * @param listener The listener to add to the list.
   * @return A listener subscription. Upon deleting that, the Listener gets removed,
   * so make sure to keep a strong reference to the subscription in memory.
   */
  std::shared_ptr<Listener> add(Callback listener) {
    std::unique_lock lock(_mutex);

    _listeners.push_back(Entry{.callback = std::move(listener)});
    auto id = --_listeners.end();

    auto weakThis = std::weak_ptr<ListenerManager<Callback>>(shared());
    return Listener::create([id, weakThis] {
      auto sharedThis = weakThis.lock();
      if (sharedThis) {
        std::unique_lock lock(sharedThis->_mutex);
        if (sharedThis->_iterationDepth > 0) {
          id->isRemoved = true;
          sharedThis->_hasRemovedListeners = true;
        } else {
          sharedThis->_listeners.erase(id);
        }
      }
    });
  }

  using LoopCallback = void(const Callback&);

  /**
   * Iterate through all listeners.
   * This method is thread-safe. Listeners may be added or removed from within the callback.
   * @param callback The callback to run for each listener.
   */
  void forEach(std::function<LoopCallback>&& callback) {
    std::unique_lock lock(_mutex);

    // Also runs when a callback throws.
    struct IterationScope {
      ListenerManager& manager;
      explicit IterationScope(ListenerManager& manager) : manager(manager) {
        manager._iterationDepth++;
      }
      ~IterationScope() {
        if (--manager._iterationDepth == 0 && manager._hasRemovedListeners) {
          manager._listeners.remove_if([](const Entry& entry) { return entry.isRemoved; });
          manager._hasRemovedListeners = false;
        }
      }
    } scope(*this);

    for (auto& entry : _listeners) {
      if (!entry.isRemoved) {
        callback(entry.callback);
      }
    }
  }

  bool getHasListeners() {
    std::unique_lock lock(_mutex);

    return std::any_of(_listeners.begin(), _listeners.end(), [](const Entry& entry) { return !entry.isRemoved; });
  }

private:
  explicit ListenerManager() {}

  std::shared_ptr<ListenerManager<Callback>> shared() {
    return this->shared_from_this();
  }

public:
  static std::shared_ptr<ListenerManager<Callback>> create() {
    return std::shared_ptr<ListenerManager<Callback>>(new ListenerManager());
  }
};

} // namespace margelo
