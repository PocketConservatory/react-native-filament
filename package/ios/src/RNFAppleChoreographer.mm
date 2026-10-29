//
//  AppleChoreographer.m
//  DoubleConversion
//
//  Created by Marc Rousavy on 23.02.24.
//

#include "RNFAppleChoreographer.h"

namespace margelo {

AppleChoreographer::AppleChoreographer() {
  _displayLink = [[DisplayLinkListener alloc] initWithCallback:^(double timestamp) {
    onFrame(timestamp);
  }];
}

AppleChoreographer::~AppleChoreographer() {
  NSLog(@"Invalidating choreographer");
  [_displayLink invalidate];
}

void AppleChoreographer::platformStop() {
  NSLog(@"Stopping choreographer");
  [_displayLink stop];
}

void AppleChoreographer::platformStart() {
  NSLog(@"Starting choreographer");
  [_displayLink start];
}

} // namespace margelo
