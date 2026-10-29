import { getWorkletDependencies } from 'react-native-worklets-core'
import { useFilamentContext } from './useFilamentContext'
import { wrapWithErrorHandler } from '../ErrorUtils'
import { RenderCallbackContext } from '../react/RenderCallbackContext'
import { useMemo } from 'react'

/**
 * Wraps a worklet in a JS function that runs it on the engine's worklet runtime and resolves with its result.
 *
 * Call the returned function from JS. Do not capture it inside another worklet or hand it to native code
 * (e.g. a collision callback): on the worklet runtime it is a remote function and cannot be invoked.
 * Pass the plain `'worklet'` function in those cases.
 */
export function useWorkletCallback<T extends (...args: any[]) => any>(callback: T): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  const { workletContext } = useFilamentContext()
  const { contextId } = RenderCallbackContext.useRenderContext()

  // Note: from react-native-worklets-core/useWorklet
  // As we want to wrap using `wrapWithErrorHandler` the dependencies must be captured from the
  // callback, not from the wrapper.

  // As a dependency for this use-memo we use all of the values captured inside the worklet,
  // as well as the unique context name.
  const dependencies = [...getWorkletDependencies(callback), contextId]

  return useMemo(
    () => {
      return workletContext.createRunAsync(wrapWithErrorHandler(callback, contextId))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    dependencies
  )
}
