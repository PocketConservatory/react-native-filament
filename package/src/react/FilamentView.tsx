import React from 'react'
import { FilamentProxy } from '../native/FilamentProxy'
import FilamentNativeView, { type FilamentViewNativeType, type NativeProps } from '../native/specs/FilamentViewNativeComponent'
import { isReleasedPointerError, NO_CONTEXT_ID, reportWorkletError, runOnWorkletContext } from '../ErrorUtils'
import { FilamentContext } from '../hooks/useFilamentContext'
import { RenderCallback, SwapChain } from 'react-native-filament'
import type { SurfaceProvider, FilamentView as RNFFilamentView } from '../native/FilamentViewTypes'
import { Listener } from '../types/Listener'
import { findNodeHandle, GestureResponderEvent } from 'react-native'
import { Worklets } from 'react-native-worklets-core'
import { getLogger } from '../utilities/logger/Logger'
import { getTouchHandlers } from './TouchHandlerContext'

const Logger = getLogger()

export type PublicNativeProps = Omit<NativeProps, 'onViewReady'>

export interface FilamentProps extends PublicNativeProps {
  /**
   * This function will be called every frame. You can use it to update your scene.
   *
   * @note Don't call any methods on `engine` here - this will lead to deadlocks!
   */
  renderCallback: RenderCallback
  /**
   * Whether rendering is paused. While paused, the view neither renders nor restarts rendering when its surface
   * is recreated or its render callback changes. Same as calling {@linkcode FilamentView.pause}/{@linkcode FilamentView.resume}.
   *
   * @default false
   */
  paused?: boolean
  /**
   * The id of the render context (see `useRenderContext().contextId`) whose `onError` handlers receive this view's
   * errors.
   * @internal
   */
  contextId?: number
}

type RefType = InstanceType<FilamentViewNativeType>

let viewIds = 0

/**
 * The component that actually renders the native view and displays our content (think of it as canvas).
 */
export class FilamentView extends React.PureComponent<FilamentProps> {
  private readonly ref: React.RefObject<RefType | null>
  private surfaceCreatedListener: Listener | undefined
  private surfaceDestroyedListener: Listener | undefined
  private renderCallbackListener: Listener | undefined
  private swapChain: SwapChain | undefined
  private view: RNFFilamentView | undefined
  // There is a race condition where the surface might be destroyed before the swapchain is created.
  // For this we keep track of the surface state:
  private isSurfaceAlive = Worklets.createSharedValue(true)
  // Bumped for every surface created or destroyed, so work started for an older surface can tell it is stale
  private surfaceGeneration = 0
  // Only the frame listener added for the latest token renders; bumping it silences older listeners at once
  private renderToken = Worklets.createSharedValue(0)
  private isPaused = Worklets.createSharedValue(false)
  // The render token whose frame listener threw. Its listener stops rendering, so the error is reported once.
  private failedRenderToken = Worklets.createSharedValue(-1)
  private isComponentMounted = false
  private viewId: number

  /**
   * Uses the context in class.
   * @note Not available in the constructor!
   */
  static contextType = FilamentContext
  // @ts-expect-error We can't use the declare keyword here as react-natives metro babel preset isn't able to handle it yet
  context!: React.ContextType<typeof FilamentContext>

  constructor(props: FilamentProps) {
    super(props)
    this.ref = React.createRef<RefType>()
    this.viewId = viewIds++
    this.isPaused.value = props.paused ?? false
  }

  private get handle(): number {
    const nodeHandle = findNodeHandle(this.ref.current)
    if (nodeHandle == null || nodeHandle === -1) {
      throw new Error("Could not get the FilamentView's native view tag! Does the FilamentView exist in the native view-tree?")
    }

    return nodeHandle
  }

  private updateTransparentRendering = (enable: boolean) => {
    const { renderer } = this.getContext()
    renderer.setClearContent(enable)
  }

  private updateRenderCallback = async (callback: RenderCallback, swapChain: SwapChain) => {
    const { renderer, view, workletContext, choreographer } = this.getContext()
    const renderToken = this.renderToken
    const token = renderToken.value + 1
    renderToken.value = token
    const isSurfaceAlive = this.isSurfaceAlive
    const isPaused = this.isPaused
    const failedRenderToken = this.failedRenderToken
    const contextId = this.props.contextId ?? NO_CONTEXT_ID

    // When requesting to update the render callback we have to assume that the previous one is not valid anymore
    // ie. its pointing to already released resources from useDisposableResource:
    const previousListener = this.renderCallbackListener
    this.renderCallbackListener = undefined

    // Adding a new render callback listener is an async operation
    Logger.debug('Setting render callback')
    const listener = await workletContext.runAsync(() => {
      'worklet'

      try {
        previousListener?.remove()
        // The surface, swapchain or choreographer may have gone away while this job was queued
        if (renderToken.value !== token || !isSurfaceAlive.value || !swapChain.isValid || !choreographer.isValid) {
          return undefined
        }

        // We need to create the function we pass to addFrameCallbackListener on the worklet thread, so that the
        // underlying JSI function is owned by that thread. Only then can we call it on the worklet thread when
        // the choreographer is calling its listeners.
        const newListener = choreographer.addFrameCallbackListener((frameInfo) => {
          'worklet'

          if (renderToken.value !== token || failedRenderToken.value === token || !swapChain.isValid) return

          try {
            callback(frameInfo)

            // The render callback may have released the swapchain
            if (!swapChain.isValid) return
            if (renderer.beginFrame(swapChain, frameInfo.timestamp)) {
              renderer.render(view)
              renderer.endFrame()
            }
          } catch (error) {
            // Resources released by an unmount or a surface loss that this frame raced with
            const isStale = renderToken.value !== token || !isSurfaceAlive.value
            if (isStale && isReleasedPointerError(error)) return
            failedRenderToken.value = token
            if (choreographer.isValid) choreographer.stop()
            reportWorkletError(error, true, contextId)
          }
        })
        // Only start after the latest successful call for attaching a listener
        if (!isPaused.value) choreographer.start()
        return newListener
      } catch (error) {
        const isStale = renderToken.value !== token || !isSurfaceAlive.value
        if (!(isStale && isReleasedPointerError(error))) reportWorkletError(error, true, contextId)
        return undefined
      }
    })
    if (listener == null) return

    // As setting the listener is async, the component might have unmounted, the surface might have been destroyed or
    // updateRenderCallback might have been called again meanwhile. Then the listener we just set is stale:
    if (!this.isComponentMounted || !this.isSurfaceAlive.value || token !== renderToken.value) {
      Logger.debug('🚧 Render callback listener is stale, removing it')
      runOnWorkletContext(
        workletContext,
        contextId,
        () => {
          'worklet'
          listener.remove()
        },
        { ignoreReleased: true }
      )
      return
    }

    this.renderCallbackListener = listener
    // resume() skips starting while the listener is in flight, and the add job may have seen the view still paused
    if (!this.isPaused.value && failedRenderToken.value !== token) choreographer.start()
    Logger.debug('Render callback set!')
  }

  private getContext = () => {
    if (this.context == null) {
      throw new Error('Filament component must be used within a FilamentProvider!')
    }

    return this.context
  }

  componentDidMount(): void {
    Logger.debug('Mounting FilamentView', this.viewId)
    this.isComponentMounted = true
    // Setup transparency mode:
    if (!this.props.enableTransparentRendering) {
      this.updateTransparentRendering(false)
    }
  }

  componentDidUpdate(prevProps: Readonly<FilamentProps>): void {
    if (prevProps.enableTransparentRendering !== this.props.enableTransparentRendering) {
      this.updateTransparentRendering(this.props.enableTransparentRendering ?? true)
    }
    if (prevProps.paused !== this.props.paused) {
      if (this.props.paused) this.pause()
      else this.resume()
    }
    if (prevProps.renderCallback !== this.props.renderCallback && this.swapChain != null) {
      // Note: if swapChain was null, the renderCallback will be set/updated in onSurfaceCreated, which uses the latest renderCallback prop
      this.updateRenderCallback(this.props.renderCallback, this.swapChain)
    }
  }

  /**
   * Calling this signals that this FilamentView will be removed, and it should release all its resources and listeners.
   */
  cleanupResources() {
    Logger.debug('Cleaning up resources')
    const { choreographer, workletContext } = this.getContext()
    this.isSurfaceAlive.value = false
    // Silences the current and any in-flight frame listener
    this.renderToken.value++

    // Stop, remove the listener and release the swapchain in one job on the render thread, so they are ordered with
    // frames and with jobs that are already queued. Clearing the fields makes a second call (onSurfaceDestroyed and
    // componentWillUnmount) a no-op.
    const listener = this.renderCallbackListener
    const swapChain = this.swapChain
    this.renderCallbackListener = undefined
    this.swapChain = undefined
    runOnWorkletContext(
      workletContext,
      this.props.contextId ?? NO_CONTEXT_ID,
      () => {
        'worklet'
        if (choreographer.isValid) choreographer.stop()
        listener?.remove()
        if (swapChain?.isValid) swapChain.release()
      },
      { ignoreReleased: true }
    )

    // Unlink the view from the choreographer. The native view might be destroyed later, after another FilamentView is created using the same choreographer (and then it would stop the rendering)
    this.view?.setChoreographer(undefined)
  }

  componentWillUnmount(): void {
    Logger.debug('Unmounting FilamentView', this.viewId)
    this.isComponentMounted = false
    this.surfaceCreatedListener?.remove()
    this.surfaceDestroyedListener?.remove()
    this.cleanupResources()
  }

  // This registers the surface provider, which will be notified when the surface is ready to draw on:
  private onViewReady = async () => {
    const context = this.getContext()
    const handle = this.handle
    Logger.debug('Finding FilamentView with handle', handle)
    try {
      this.view = await FilamentProxy.findFilamentView(handle)
    } catch (error) {
      if (!this.isComponentMounted) {
        // The native view is already gone, nothing left to set up
        Logger.debug('➡️ Component already unmounted, skipping setup')
        return
      }
      throw error
    }
    if (this.view == null) {
      throw new Error(`Failed to find FilamentView #${handle}!`)
    }
    if (!this.isComponentMounted) {
      // It can happen that while the above async function executed the view was already removed
      Logger.debug('➡️ Component already unmounted, skipping setup')
      return
    }
    Logger.debug('Found FilamentView!')
    // Link the view with the choreographer.
    // When the view gets destroyed, the choreographer will be stopped.
    this.view.setChoreographer(context.choreographer)

    if (this.ref.current == null) {
      throw new Error('Ref is not set!')
    }

    const surfaceProvider = this.view.getSurfaceProvider()
    const filamentDispatcher = FilamentProxy.getCurrentDispatcher()
    this.surfaceCreatedListener = surfaceProvider.addOnSurfaceCreatedListener(() => {
      this.onSurfaceCreated(surfaceProvider)
    }, filamentDispatcher)
    this.surfaceDestroyedListener = surfaceProvider.addOnSurfaceDestroyedListener(() => {
      this.onSurfaceDestroyed()
    }, filamentDispatcher)
    // Link the surface with the engine:
    Logger.debug('Setting surface provider')
    context.engine.setSurfaceProvider(surfaceProvider)
    // Its possible that the surface is already created, then our callback wouldn't be called
    // (we still keep the callback as on android a surface can be destroyed and recreated, while the view stays alive)
    if (surfaceProvider.getSurface() != null) {
      Logger.debug('Surface already created!')
      this.onSurfaceCreated(surfaceProvider)
    }
  }

  // This will be called once the surface is created and ready to draw on:
  private onSurfaceCreated = async (surfaceProvider: SurfaceProvider) => {
    Logger.debug('Surface created!')
    const surfaceGeneration = ++this.surfaceGeneration
    const isSurfaceAlive = this.isSurfaceAlive
    isSurfaceAlive.value = true
    const { engine, workletContext } = this.getContext()
    // Create a swap chain …
    const enableTransparentRendering = this.props.enableTransparentRendering ?? true
    const contextId = this.props.contextId ?? NO_CONTEXT_ID
    Logger.debug('Creating swap chain')
    const swapChain = await workletContext.runAsync(() => {
      'worklet'

      if (!isSurfaceAlive.value) {
        return null
      }

      try {
        const newSwapChain = engine.createSwapChainForSurface(surfaceProvider, enableTransparentRendering)
        // Set on the render thread so it is ordered with the swapchain release, which runs there too
        engine.setSwapChain(newSwapChain)
        return newSwapChain
      } catch (error) {
        // Report this error as none-fatal. We only throw in createSwapChainForSurface if the surface is already released.
        // There is the chance of a race condition where the surface is destroyed but our JS onDestroy listener hasn't been called yet.
        reportWorkletError(error, false, contextId)
        return null
      }
    })

    const isCurrentSurface = this.isComponentMounted && surfaceGeneration === this.surfaceGeneration && isSurfaceAlive.value
    if (swapChain == null) {
      if (isCurrentSurface) isSurfaceAlive.value = false
      Logger.info('🚧 Swap chain is null, surface was already destroyed while we tried to create a swapchain from it.')
      return
    }
    if (!isCurrentSurface) {
      Logger.info('🚧 Surface was destroyed or the component unmounted while creating the swap chain, releasing it.')
      runOnWorkletContext(
        workletContext,
        contextId,
        () => {
          'worklet'
          if (swapChain.isValid) swapChain.release()
        },
        { ignoreReleased: true }
      )
      return
    }
    this.swapChain = swapChain

    // Set the render callback in the choreographer:
    const { renderCallback } = this.props
    await this.updateRenderCallback(renderCallback, swapChain)
  }

  /**
   * On surface destroyed might be called multiple times for the same native view (FilamentView).
   * On android if a surface is destroyed, it can be recreated, while the view stays alive.
   */
  private onSurfaceDestroyed = () => {
    Logger.info('Surface destroyed!')
    this.surfaceGeneration++
    this.cleanupResources()
  }

  /**
   * Pauses the rendering of the Filament view.
   */
  public pause = (): void => {
    Logger.info('Pausing rendering')
    this.isPaused.value = true
    const { choreographer } = this.getContext()
    choreographer.stop()
  }

  /**
   * Resumes the rendering of the Filament view.
   * It's a no-op if the rendering is already running.
   */
  public resume = (): void => {
    Logger.info('Resuming rendering')
    this.isPaused.value = false
    // Without a listener there is nothing to render. A listener that is being added starts the choreographer itself.
    if (this.renderCallbackListener == null) return
    const { choreographer } = this.getContext()
    choreographer.start()
  }

  private onTouchStart = (event: GestureResponderEvent) => {
    if (this.props.onTouchStart != null) {
      this.props.onTouchStart(event)
    }

    // Gets the registered callbacks from the TouchHandlerContext
    // This way we only have one real gesture responder event handler
    const touchHandlers = getTouchHandlers()
    const callbacks = Object.values(touchHandlers)
    Logger.debug('onTouchStart, handlers count:', callbacks.length)
    for (const handler of callbacks) {
      handler(event)
    }
  }

  /** @internal */
  public render(): React.ReactNode {
    return <FilamentNativeView ref={this.ref} onViewReady={this.onViewReady} {...this.props} onTouchStart={this.onTouchStart} />
  }
}

// @ts-expect-error Not in the types
FilamentView.defaultProps = {
  enableTransparentRendering: true,
}
