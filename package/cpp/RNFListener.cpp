//
// Created by Marc Rousavy on 21.02.24.
//

#include "RNFListener.h"
#include "RNFLogger.h"

namespace margelo {

Listener::Listener(ListenerRemover&& remove) : HybridObject(TAG), _remove(std::move(remove)), _isRemoved(false) {
  Logger::log(TAG, "Creating Listener...");
}

Listener::~Listener() {
  Logger::log(TAG, "Destroying Listener...");
  remove();
}

void Listener::loadHybridMethods() {
  registerHybridMethod("remove", &Listener::remove, this);
}

void Listener::remove() {
  // JS, worklet and GC threads may remove the same listener concurrently.
  if (_isRemoved.exchange(true)) {
    return;
  }
  _remove();
}

std::shared_ptr<Listener> Listener::create(ListenerRemover&& remover) {
  return std::shared_ptr<Listener>(new Listener(std::move(remover)));
}

} // namespace margelo
