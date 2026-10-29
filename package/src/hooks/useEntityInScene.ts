import { useEffect } from 'react'
import { Entity, Scene } from '../types'
import { useFilamentContext } from './useFilamentContext'
import { runOnWorkletContext } from '../ErrorUtils'
import { RenderCallbackContext } from '../react/RenderCallbackContext'

/**
 * A hook that "on mount" adds the entity to the scene, and "on unmount" removes it.
 * Both run on the worklet thread.
 */
export function useEntityInScene(scene: Scene, entity?: Entity) {
  const { workletContext } = useFilamentContext()
  const { contextId } = RenderCallbackContext.useRenderContext()

  useEffect(() => {
    if (entity == null) return
    runOnWorkletContext(workletContext, contextId, () => {
      'worklet'
      scene.addEntity(entity)
    })

    return () => {
      runOnWorkletContext(
        workletContext,
        contextId,
        () => {
          'worklet'
          scene.removeEntity(entity)
        },
        { ignoreReleased: true }
      )
    }
  }, [contextId, entity, scene, workletContext])
}
