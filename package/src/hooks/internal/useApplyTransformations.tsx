import { useEffect, useRef } from 'react'
import { TransformationProps } from '../../types/TransformProps'
import { useFilamentContext } from '../useFilamentContext'
import { AABB, Entity, Float3 } from '../../types'
import { areFloat3Equal, isWorkletSharedValue } from '../../utilities/helper'
import { useWorkletEffect } from '../useWorkletEffect'
import { ISharedValue, Worklets } from 'react-native-worklets-core'
import { runOnWorkletContext } from '../../ErrorUtils'
import { RenderCallbackContext } from '../../react/RenderCallbackContext'

type Params = {
  // If null it will not take the entity from the context, as it indicates that it will be provided through the param
  to?: Entity | null
  transformProps?: TransformationProps
  // If transformToUnitCube is true, the aabb is required
  aabb?: AABB
}

/**
 * Takes the next entity from the context and applies all transformations from the next
 * transformation context to it
 */
export function useApplyTransformations({ to: entity, transformProps, aabb }: Params) {
  const { translate: position, scale, rotate, transformToUnitCube, multiplyWithCurrentTransform = true } = transformProps ?? {}

  const { transformManager, workletContext } = useFilamentContext()
  const { contextId } = RenderCallbackContext.useRenderContext()
  // TODO: multiplying current transformations is a bit problematic with react.
  // E.g. in strict mode or concurrent rendering our effects can be called multiple times.
  // Running an effect multiple times with transformation multiplication can lead to unexpected results.
  const prevScale = useRef<Float3 | null>(null)
  const prevRotate = useRef<Float3 | null>(null)
  const prevPosition = useRef<Float3 | null>(null)

  useEffect(() => {
    if (entity == null) return

    const unitCubeAabb = transformToUnitCube ? aabb : undefined
    let newScale: Float3 | undefined
    let newRotate: Float3 | undefined
    let newPosition: Float3 | undefined

    if (!isWorkletSharedValue(scale) && Array.isArray(scale) && (prevScale.current == null || !areFloat3Equal(scale, prevScale.current))) {
      newScale = scale
      prevScale.current = scale
    }

    if (
      !isWorkletSharedValue(rotate) &&
      Array.isArray(rotate) &&
      (prevRotate.current == null || !areFloat3Equal(rotate, prevRotate.current))
    ) {
      newRotate = rotate
      prevRotate.current = rotate
    }

    if (
      !isWorkletSharedValue(position) &&
      Array.isArray(position) &&
      (prevPosition.current == null || !areFloat3Equal(position, prevPosition.current))
    ) {
      newPosition = position
      prevPosition.current = position
    }

    if (unitCubeAabb == null && newScale == null && newRotate == null && newPosition == null) return

    // Filament is not thread-safe, so transforms are applied on the worklet thread that renders
    runOnWorkletContext(workletContext, contextId, () => {
      'worklet'
      if (unitCubeAabb != null) {
        transformManager.transformToUnitCube(entity, unitCubeAabb)
      }
      if (newScale != null) {
        transformManager.setEntityScale(entity, newScale, multiplyWithCurrentTransform)
      }
      if (newRotate != null) {
        const [x, y, z] = newRotate
        transformManager.setEntityRotation(entity, x, [1, 0, 0], multiplyWithCurrentTransform)
        // Rotation across axis is one operation so we need to always multiply the remaining rotations:
        transformManager.setEntityRotation(entity, y, [0, 1, 0], true)
        transformManager.setEntityRotation(entity, z, [0, 0, 1], true)
      }
      if (newPosition != null) {
        transformManager.setEntityPosition(entity, newPosition, multiplyWithCurrentTransform)
      }
    })
  }, [
    aabb,
    contextId,
    entity,
    multiplyWithCurrentTransform,
    position,
    prevPosition,
    prevRotate,
    prevScale,
    rotate,
    scale,
    transformManager,
    transformToUnitCube,
    workletContext,
  ])

  const prevScaleShared = useRef(isWorkletSharedValue(scale) ? Worklets.createSharedValue<Float3 | null>(null) : null)
  const prevRotateShared = useRef(isWorkletSharedValue(rotate) ? Worklets.createSharedValue<Float3 | null>(null) : null)
  const prevPositionShared = useRef(isWorkletSharedValue(position) ? Worklets.createSharedValue<Float3 | null>(null) : null)

  // Effects for when a transform option is a shared value (SRT)
  useWorkletEffect(() => {
    'worklet'

    if (entity == null) return

    const unsubscribers: (() => void)[] = []

    // Generic handler for worklet transform values
    const createTransformHandler = (
      value: any,
      prevValueShared: ISharedValue<Float3 | null> | null,
      updater: (newValue: Float3) => void
    ) => {
      'worklet'
      if (value == null || !isWorkletSharedValue(value) || Array.isArray(value)) return null

      const unsubscribe = value.addListener(() => {
        'worklet'

        // Check if value has changed to avoid duplicate applications in strict mode
        if (prevValueShared?.value && areFloat3Equal(value.value, prevValueShared.value)) {
          return
        }

        updater(value.value)

        // Update previous value tracker
        if (prevValueShared) {
          prevValueShared.value = [value.value[0], value.value[1], value.value[2]]
        }
      })

      unsubscribers.push(unsubscribe)
      return value
    }

    // Set up handlers for each transform type
    const scaleHandler = createTransformHandler(scale, prevScaleShared.current, (newScale) => {
      'worklet'
      transformManager.setEntityScale(entity, [newScale[0], newScale[1], newScale[2]], multiplyWithCurrentTransform)
    })

    const rotateHandler = createTransformHandler(rotate, prevRotateShared.current, (newRotate) => {
      'worklet'
      const [x, y, z] = newRotate
      transformManager.setEntityRotation(entity, x, [1, 0, 0], multiplyWithCurrentTransform)
      // Rotation across axis is one operation so we need to always multiply the remaining rotations:
      transformManager.setEntityRotation(entity, y, [0, 1, 0], true)
      transformManager.setEntityRotation(entity, z, [0, 0, 1], true)
    })

    const positionHandler = createTransformHandler(position, prevPositionShared.current, (newPosition) => {
      'worklet'
      transformManager.setEntityPosition(entity, newPosition, multiplyWithCurrentTransform)
    })

    // Trigger initial values in order: scale -> rotation -> position
    if (scaleHandler) {
      scaleHandler.value = [scaleHandler.value[0], scaleHandler.value[1], scaleHandler.value[2]]
    }
    if (rotateHandler) {
      rotateHandler.value = [rotateHandler.value[0], rotateHandler.value[1], rotateHandler.value[2]]
    }
    if (positionHandler) {
      positionHandler.value = [positionHandler.value[0], positionHandler.value[1], positionHandler.value[2]]
    }

    return () => {
      'worklet'
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  })
}
