import type { Engine, EngineBackend, EngineConfig } from '../types'
import { FilamentProxy } from '../native/FilamentProxy'
import { IWorkletContext, useWorklet } from 'react-native-worklets-core'
import { useDisposableResource } from './useDisposableResource'

export interface EngineProps {
  /**
   * The backend to be used. By default it picks "opengl" for android and "metal" for ios.
   */
  backend?: EngineBackend

  /**
   * The engine config. Can be used to tweak buffer sizes.
   * You probably don't need that unless you do a lot and ran into engine crashes.
   */
  config?: EngineConfig

  /** Creates an offscreen engine on the dedicated export context. */
  exportMode?: boolean
  context: IWorkletContext
}

export function useEngine({ backend, config, context, exportMode }: EngineProps): Engine | undefined {
  // Important: create the engine on the worklet thread, so its owned by the worklet thread
  const createEngine = useWorklet(context, () => {
    'worklet'
    return exportMode
      ? FilamentProxy.createExportEngine(backend ?? undefined, config ?? undefined)
      : FilamentProxy.createEngine(backend ?? undefined, config ?? undefined)
  })

  const engine = useDisposableResource(createEngine, undefined, context)
  return engine
}
