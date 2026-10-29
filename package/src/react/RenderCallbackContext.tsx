import React, { createContext, DependencyList, PropsWithChildren, useCallback, useContext, useEffect, useMemo } from 'react'
import { FrameInfo, RenderCallback } from 'react-native-filament'
import { isWorklet } from 'react-native-worklets-core'
import { useFilamentContext } from '../hooks/useFilamentContext'
import { FilamentErrorHandler, runOnWorkletContext } from '../ErrorUtils'
import { useErrorHandler } from '../hooks/internal/useErrorHandler'

let nextContextId = 0
let nextCallbackId = 0

/**
 * Calls every render callback registered for the given context id. Call it from the render callback of the
 * FilamentView. For the default exported context this happens automatically.
 */
export const runRenderCallbacks = (contextId: number, frameInfo: FrameInfo) => {
  'worklet'
  const callbacks = global.__rnfRenderCallbacks?.[contextId]
  if (callbacks == null) return
  for (const id in callbacks) {
    callbacks[id]?.(frameInfo)
  }
}

/**
 * In react-native-filament we can only have one render callback, which we provide to the FilamentView.
 * This context allows us to have multiple render callbacks, as we call them in the render callback.
 *
 * The callbacks are kept in a registry on the scene's worklet runtime, keyed by context and callback id.
 * Adding and removing them are jobs on that runtime, so they are ordered with everything else scheduled
 * there (like releasing the resources a callback uses).
 */
export type RenderContextType = {
  /**
   * The id of this context's entry in the render callback registry. Pass it to {@linkcode runRenderCallbacks}.
   */
  contextId: number
  addRenderCallback: (callback: RenderCallback) => () => void
}

export const makeRenderContext = () => {
  const RenderContext = createContext<RenderContextType>({
    contextId: -1,
    addRenderCallback: () => {
      throw new Error('RenderContextProvider not found')
    },
  })

  /**
   * @param onError See `FilamentScene`'s `onError`.
   */
  const RenderContextProvider = ({ children, onError }: PropsWithChildren<{ onError?: FilamentErrorHandler }>) => {
    const { workletContext } = useFilamentContext()
    const contextId = useMemo(() => nextContextId++, [])

    useErrorHandler(contextId, onError)

    useEffect(() => {
      return () => {
        runOnWorkletContext(workletContext, contextId, () => {
          'worklet'
          delete global.__rnfRenderCallbacks?.[contextId]
        })
      }
    }, [contextId, workletContext])

    const addRenderCallback = useCallback(
      (callback: RenderCallback) => {
        if (__DEV__ && !isWorklet(callback)) {
          throw new Error('Render callbacks must be worklets. Add a "worklet" directive to the function.')
        }
        const callbackId = nextCallbackId++
        runOnWorkletContext(workletContext, contextId, () => {
          'worklet'
          if (global.__rnfRenderCallbacks == null) global.__rnfRenderCallbacks = {}
          const registry = global.__rnfRenderCallbacks
          if (registry[contextId] == null) registry[contextId] = {}
          registry[contextId][callbackId] = callback
        })
        return () => {
          runOnWorkletContext(workletContext, contextId, () => {
            'worklet'
            delete global.__rnfRenderCallbacks?.[contextId]?.[callbackId]
          })
        }
      },
      [contextId, workletContext]
    )

    const contextValue = useMemo<RenderContextType>(() => ({ contextId, addRenderCallback }), [addRenderCallback, contextId])

    return <RenderContext.Provider value={contextValue}>{children}</RenderContext.Provider>
  }

  const useRenderContext = () => {
    const context = useContext(RenderContext)

    if (!context) {
      throw new Error('useRenderContext must be used within a RenderContextProvider')
    }

    return context
  }

  /**
   * Use this method to add render callbacks to the render callback chain.
   */
  const useRenderCallback = (callback: RenderCallback, deps: DependencyList) => {
    const { addRenderCallback } = useRenderContext()

    useEffect(() => {
      const remove = addRenderCallback(callback)

      return () => {
        remove()
      }
      // Explicitly skip the callback, we memoize by the provided dependencies
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...deps, addRenderCallback])

    return callback
  }

  return { useRenderContext, RenderContextProvider, useRenderCallback, runRenderCallbacks }
}

export const RenderCallbackContext = makeRenderContext()
