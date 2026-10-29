import { PropsWithChildren, useMemo } from 'react'
import { FilamentProxy, FilamentWorkletContext, getFilamentExportWorkletContext } from '../native/FilamentProxy'
import { EngineProps, useEngine } from '../hooks/useEngine'
import { useDisposableResource } from '../hooks/useDisposableResource'
import { useWorklet } from 'react-native-worklets-core'
import React from 'react'
import { Configurator, RendererConfigProps, ViewConfigProps } from './Configurator'
import { FilamentContext, FilamentContextType } from '../hooks/useFilamentContext'
import { RenderCallbackContext } from './RenderCallbackContext'
import { FilamentErrorHandler } from '../ErrorUtils'

export type FilamentProviderProps = PropsWithChildren<
  Omit<EngineProps, 'context'> &
    ViewConfigProps &
    RendererConfigProps & {
      fallback?: React.ReactElement
      /**
       * Receives errors from the scene's worklets and render loop on the JS thread, e.g. to show a fallback.
       *
       * - Without a handler, errors are reported as fatal errors, as without this prop.
       * - With a handler, errors go to the handler and are not fatal. An error in the render loop stops rendering
       *   and is reported once.
       * - Errors from using an already released object during teardown are dropped.
       * - Once a handler was set, the scene's errors stay non-fatal after it is removed, as errors can still
       *   arrive after unmount. They are then reported with `ErrorUtils.reportError`.
       */
      onError?: FilamentErrorHandler
    }
>

/**
 * The `<FilamentScene>` holds contextual values for a Filament rendering scene.
 *
 * You need to wrap your rendering scene (= a component that uses `<FilamentView>`, hooks or
 * other Filament components) with a `<FilamentScene>`.
 *
 * @note Make sure to wrap your scene in a parent component, otherwise the React context cannot be inferred.
 * @example
 * ```tsx
 * function Scene() {
 *   // in here you can use Filament's hooks and components
 *   return (
 *    <FilamentView style={styles.container}>
 *      <DefaultLight />
 *      <Model source={{ uri: modelPath }} />
 *    </FilamentView>
 *  )
 * }
 *
 * export function RocketModel() {
 *   // in here you only need to wrap the child-component with <FilamentScene>
 *   return (
 *     <FilamentScene>
 *       <Scene />
 *     </FilamentScene>
 *   )
 * }
 * ```
 */
export function FilamentScene({
  children,
  fallback,
  config,
  backend,
  frameRateOptions,
  exportMode = false,
  onError,
  ...viewProps
}: FilamentProviderProps) {
  // First create the engine, which we need to create (almost) all other filament APIs
  const workletContext = exportMode ? getFilamentExportWorkletContext() : FilamentWorkletContext
  const engine = useEngine({ config, backend, context: workletContext, exportMode })

  // Create all Filament APIs using the engine
  const transformManager = useDisposableResource(() => Promise.resolve(engine?.createTransformManager()), [engine], workletContext)
  const renderableManager = useDisposableResource(() => Promise.resolve(engine?.createRenderableManager()), [engine], workletContext)
  const scene = useDisposableResource(() => Promise.resolve(engine?.getScene()), [engine], workletContext)
  const lightManager = useDisposableResource(() => Promise.resolve(engine?.createLightManager()), [engine], workletContext)
  const view = useDisposableResource(() => Promise.resolve(engine?.getView()), [engine], workletContext)
  const camera = useDisposableResource(() => Promise.resolve(engine?.getCamera()), [engine], workletContext)
  const renderer = useDisposableResource(() => Promise.resolve(engine?.createRenderer()), [engine], workletContext)
  const nameComponentManager = useDisposableResource(() => Promise.resolve(engine?.createNameComponentManager()), [engine], workletContext)

  // Create a choreographer for this context tree
  const choreographer = useDisposableResource(
    useWorklet(workletContext, () => {
      'worklet'
      return FilamentProxy.createChoreographer()
    }),
    undefined,
    workletContext
  )

  // Construct the context object value:
  const value = useMemo<FilamentContextType | undefined>(() => {
    if (
      transformManager == null ||
      renderableManager == null ||
      scene == null ||
      lightManager == null ||
      view == null ||
      camera == null ||
      renderer == null ||
      nameComponentManager == null ||
      choreographer == null ||
      engine == null
    ) {
      return undefined
    }

    return {
      engine,
      transformManager,
      renderableManager,
      scene,
      lightManager,
      view,
      camera,
      renderer,
      nameComponentManager,
      workletContext,
      choreographer: choreographer,
    }
  }, [
    engine,
    transformManager,
    renderableManager,
    scene,
    lightManager,
    view,
    camera,
    renderer,
    nameComponentManager,
    choreographer,
    workletContext,
  ])

  const rendererProps = useMemo(() => ({ frameRateOptions }), [frameRateOptions])

  // If the APIs aren't ready yet render the fallback component (or nothing)
  if (value == null) return fallback ?? null
  return (
    <FilamentContext.Provider value={value}>
      <Configurator rendererProps={rendererProps} viewProps={viewProps}>
        <RenderCallbackContext.RenderContextProvider onError={onError}>{children}</RenderCallbackContext.RenderContextProvider>
      </Configurator>
    </FilamentContext.Provider>
  )
}
