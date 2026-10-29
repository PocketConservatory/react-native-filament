//
//  DisplayLinkListener.m
//  DoubleConversion
//
//  Created by Marc Rousavy on 23.02.24.
//

#import "RNFDisplayLinkListener.h"
#import <Foundation/Foundation.h>
#import <QuartzCore/CADisplayLink.h>

@implementation DisplayLinkListener {
  CADisplayLink* _Nullable _displayLink;
  OnFrameCallback _callback;
  bool shouldContinueOnEnterForeground;
  // Whether start() was called more recently than stop(). Background/foreground transitions must not resume a stopped
  // display link.
  bool _running;
}
- (instancetype)initWithCallback:(OnFrameCallback)callback {
  if (self = [super init]) {
    _callback = callback;
    _displayLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(onFrame:)];
    _displayLink.paused = YES;
    shouldContinueOnEnterForeground = NO;
    _running = NO;
    [_displayLink addToRunLoop:[NSRunLoop currentRunLoop] forMode:NSDefaultRunLoopMode];

    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(appDidEnterBackground)
                                                 name:UIApplicationDidEnterBackgroundNotification
                                               object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(appWillEnterForeground)
                                                 name:UIApplicationWillEnterForegroundNotification
                                               object:nil];
  }
  return self;
}

- (void)start {
  @synchronized(self) {
    _running = YES;
    _displayLink.paused = NO;
  }
}

- (void)stop {
  @synchronized(self) {
    _running = NO;
    shouldContinueOnEnterForeground = NO;
    _displayLink.paused = YES;
  }
}

- (void)invalidate {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
  @synchronized(self) {
    _running = NO;
    [_displayLink invalidate];
    _displayLink = nil;
  }
}

- (void)onFrame:(CADisplayLink*)displayLink {
  _callback(displayLink.timestamp * 1e9);
}

// When the app enters the background we need to stop sending commands to metal.
// Otherwise we run the risk of the metal view becoming blank, or not being able to update it anymore.
- (void)appDidEnterBackground {
  @synchronized(self) {
    shouldContinueOnEnterForeground = !_displayLink.paused;
    _displayLink.paused = YES;
  }
  NSLog(@"[react-native-filament] [DisplayLinkListener] Paused rendering, app entered background.");
}

- (void)appWillEnterForeground {
  @synchronized(self) {
    if (!shouldContinueOnEnterForeground || !_running) {
      return;
    }
    _displayLink.paused = NO;
  }
  NSLog(@"[react-native-filament] [DisplayLinkListener] Resumed rendering, app entered foreground.");
}

- (void)dealloc {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

@end
