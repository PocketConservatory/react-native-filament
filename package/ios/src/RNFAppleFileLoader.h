#pragma once

#import <Foundation/Foundation.h>
#include <stdexcept>
#include <string>

namespace margelo {

/** Reads a file URL into mapped data when possible; throws if the file cannot be read. */
inline NSData* loadFileURL(NSString* fileURL) {
  NSURL* url = [NSURL URLWithString:fileURL];
  if (url == nil || !url.isFileURL) {
    throw std::runtime_error("Invalid file URL");
  }
  NSError* error = nil;
  NSData* data = [NSData dataWithContentsOfURL:url options:NSDataReadingMappedIfSafe error:&error];
  if (data == nil) {
    const char* description = error.localizedDescription.UTF8String;
    throw std::runtime_error(std::string("File not found or could not be read, error: ") +
                             (description != nullptr ? description : "Unknown file read error"));
  }
  return data;
}

} // namespace margelo
