import { useEffect } from 'react'
import { useFilamentContext } from './useFilamentContext'
import { getWorkletDependencies, isWorklet } from 'react-native-worklets-core'
import { runOnWorkletContext, wrapWithErrorHandler } from '../ErrorUtils'
import { RenderCallbackContext } from '../react/RenderCallbackContext'

type CleanupFn = () => void

export function useWorkletEffect(workletFunction: () => CleanupFn | void) {
  const { workletContext } = useFilamentContext()
  const { contextId } = RenderCallbackContext.useRenderContext()

  useEffect(() => {
    // Errors are reported by wrapWithErrorHandler, don't report the rejection again
    const cleanupPromise = workletContext.runAsync(wrapWithErrorHandler(workletFunction, contextId)).catch(() => undefined)
    return () => {
      cleanupPromise.then((cleanup): void => {
        if (cleanup == null || typeof cleanup !== 'function') {
          // no cleanup function was returned, do nothing.
          return
        }
        if (isWorklet(cleanup)) {
          // call cleanup function on Worklet context
          runOnWorkletContext(workletContext, contextId, cleanup, { ignoreReleased: true })
        } else {
          // call normal cleanup JS function on normal context
          cleanup()
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, getWorkletDependencies(workletFunction))
}
