import { useEffect } from 'react'
import { Entity, Scene } from '../types'
import { useFilamentContext } from './useFilamentContext'

/**
 * A hook that "on mount" adds the entity to the scene, and "on unmount" removes it.
 * Both run on the worklet thread.
 */
export function useEntityInScene(scene: Scene, entity?: Entity) {
  const { workletContext } = useFilamentContext()

  useEffect(() => {
    if (entity == null) return
    workletContext.runAsync(() => {
      'worklet'
      scene.addEntity(entity)
    })

    return () => {
      workletContext.runAsync(() => {
        'worklet'
        scene.removeEntity(entity)
      })
    }
  }, [entity, scene, workletContext])
}
