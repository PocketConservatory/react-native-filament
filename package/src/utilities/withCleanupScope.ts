import type { IWorkletContext } from 'react-native-worklets-core'

/**
 * Operations that are releasing memory from JS should be executed after cleanup functions
 * that are still operating on the resource.
 * For example in a cleanup you might remove an asset from the scene, but you also want to release the memory of the asset.
 * The memory release() function call should be wrapped with withCleanupScope.
 *
 * When a `workletContext` is given, `cleanupFunction` must be a worklet and runs on that context.
 *
 * @note You probably don't need to call this yourself!
 *
 * @example
 *
 * ```ts
 * useEffect(() => {
 *  const asset = // ... acquire some resources
 *
 *   return withCleanupScope(() => {
 *     asset.release()
 *   })
 * })
 * ```
 */
export function withCleanupScope(cleanupFunction: Function, workletContext?: IWorkletContext) {
  return () => {
    // Defer to the next tick, so synchronous cleanup functions of this commit
    // can finish using the resource before it is released.
    setTimeout(() => {
      if (workletContext != null) {
        // Queued behind the jobs already scheduled on that context, which may still be using the resource
        workletContext.runAsync(cleanupFunction as () => void)
      } else {
        cleanupFunction()
      }
    }, 0)
  }
}
