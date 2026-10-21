#import "../../package/ios/src/RNFAppleFileLoader.h"
#include <iostream>

int main() {
  @autoreleasepool {
    NSFileManager* files = [NSFileManager defaultManager];
    NSURL* directory = [[NSURL fileURLWithPath:NSTemporaryDirectory() isDirectory:YES]
        URLByAppendingPathComponent:NSUUID.UUID.UUIDString isDirectory:YES];
    NSError* error = nil;
    if (![files createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:&error]) {
      std::cerr << "Could not create test directory\n";
      return 1;
    }
    int failures = 0;
    NSData* expected = [@"Filament asset bytes" dataUsingEncoding:NSUTF8StringEncoding];
    for (NSString* name in @[@"ordinary.glb", @"Application Support/asset.glb", @"音楽/é.glb", @"literal%20.glb"]) {
      NSURL* file = [directory URLByAppendingPathComponent:name];
      if (![files createDirectoryAtURL:file.URLByDeletingLastPathComponent
           withIntermediateDirectories:YES attributes:nil error:&error] ||
          ![expected writeToURL:file options:0 error:&error]) {
        std::cerr << "Could not create fixture\n";
        failures++;
        continue;
      }
      try {
        if (![margelo::loadFileURL(file.absoluteString) isEqualToData:expected]) {
          throw std::runtime_error("Loaded bytes differ from fixture");
        }
        std::cout << "PASS " << name.UTF8String << '\n';
      } catch (const std::exception& exception) {
        std::cerr << "FAIL " << name.UTF8String << ": " << exception.what() << '\n';
        failures++;
      }
    }
    try {
      margelo::loadFileURL([directory URLByAppendingPathComponent:@"missing.glb"].absoluteString);
      std::cerr << "FAIL missing file did not throw\n";
      failures++;
    } catch (const std::runtime_error& exception) {
      if (std::string(exception.what()).empty()) {
        failures++;
      } else {
        std::cout << "PASS missing file throws a descriptive error\n";
      }
    }
    [files removeItemAtURL:directory error:nil];
    return failures == 0 ? 0 : 1;
  }
}
