import React, { PropsWithChildren, useCallback } from 'react'
import { RenderCallbackContext, runRenderCallbacks } from './RenderCallbackContext'
import { FilamentProps, FilamentView, PublicNativeProps } from './FilamentView'
import { RenderCallback } from '../types'
import { StyleSheet, ViewStyle } from 'react-native'
import { FilamentErrorHandler } from '../ErrorUtils'
import { useErrorHandler } from '../hooks/internal/useErrorHandler'

type ForwardProps = PublicNativeProps &
  Pick<FilamentProps, 'paused'> & {
    style?: ViewStyle
    renderCallback?: RenderCallback
    /**
     * Receives this scene's render and worklet errors on the JS thread, like the `FilamentScene`'s `onError` (see
     * there). When both are set, both receive every error.
     */
    onError?: FilamentErrorHandler
  }

/**
 * This is the component actually exposed to the user. It wraps the `FilamentView` and adds the renderCallbacks.
 * @private
 */
export function FilamentViewWithRenderCallbacks({
  children,
  renderCallback: renderCallbackProp,
  onError,
  ...forwardProps
}: PropsWithChildren<ForwardProps>) {
  const { contextId } = RenderCallbackContext.useRenderContext()
  const renderCallback: RenderCallback = useCallback(
    (frameInfo) => {
      'worklet'

      renderCallbackProp?.(frameInfo)
      runRenderCallbacks(contextId, frameInfo)
    },
    [renderCallbackProp, contextId]
  )

  useErrorHandler(contextId, onError)

  return (
    <FilamentView renderCallback={renderCallback} contextId={contextId} {...forwardProps} style={[styles.container, forwardProps.style]}>
      {children}
    </FilamentView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
})
