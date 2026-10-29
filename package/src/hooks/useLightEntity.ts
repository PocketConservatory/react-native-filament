import { useEffect, useState } from 'react'
import { Entity, LightConfig, LightManager, Scene } from '../types'
import { ISharedValue } from 'react-native-worklets-core'
import { useFilamentContext } from './useFilamentContext'
import { useWorkletEffect } from './useWorkletEffect'
import convertKelvinToLinearSRGB from '../utilities/convertKelvinToLinearSRGB'

export type UseLightEntityProps =
  | LightConfig
  | (Omit<LightConfig, 'intensity' | 'colorKelvin'> & {
      intensity?: number | ISharedValue<number>
      colorKelvin?: number | ISharedValue<number>
    })

/**
 * Creates a new memoized light entity based on the given configuration, and destroys it on unmount or when the
 * configuration changes. The light is created and destroyed on the worklet thread, so the entity is `undefined`
 * until it exists.
 */
export function useLightEntity(lightManager: LightManager, config: UseLightEntityProps): Entity | undefined {
  return useLightEntityInScene(lightManager, config, undefined)
}

/**
 * Like {@linkcode useLightEntity}, but also adds the light to `scene`. Creating, adding, removing and destroying
 * the light run in that order on the worklet thread.
 * @internal
 */
export function useLightEntityInScene(lightManager: LightManager, config: UseLightEntityProps, scene: Scene | undefined) {
  const falloffRadius = 'falloffRadius' in config ? config.falloffRadius : undefined
  const spotLightCone = 'spotLightCone' in config ? config.spotLightCone : undefined

  // Unwrap all array-ish values so the user doesn't have to memo them!
  const directionX = config.direction?.[0] ?? undefined
  const directionY = config.direction?.[1] ?? undefined
  const directionZ = config.direction?.[2] ?? undefined

  const positionX = config.position?.[0] ?? undefined
  const positionY = config.position?.[1] ?? undefined
  const positionZ = config.position?.[2] ?? undefined

  const innerSpotLightCone = spotLightCone?.[0] ?? undefined
  const outerSpotLightCone = spotLightCone?.[1] ?? undefined

  const { type, castShadows, colorKelvin: initialColorKelvin, intensity: initialIntensity } = config
  const { workletContext } = useFilamentContext()
  const [entity, setEntity] = useState<Entity>()

  useEffect(() => {
    let isActive = true
    const created = workletContext.runAsync(() => {
      'worklet'
      const lightEntity = lightManager.createLightEntity(
        type,
        typeof initialColorKelvin === 'number' ? initialColorKelvin : initialColorKelvin?.value,
        typeof initialIntensity === 'number' ? initialIntensity : initialIntensity?.value,
        directionX != null && directionY != null && directionZ != null ? [directionX, directionY, directionZ] : undefined,
        positionX != null && positionY != null && positionZ != null ? [positionX, positionY, positionZ] : undefined,
        castShadows,
        falloffRadius,
        innerSpotLightCone != null && outerSpotLightCone != null ? [innerSpotLightCone, outerSpotLightCone] : undefined
      )
      scene?.addEntity(lightEntity)
      return lightEntity
    })
    created.then((lightEntity) => {
      if (isActive) setEntity(lightEntity)
    })

    return () => {
      isActive = false
      setEntity(undefined)
      created.then((lightEntity) => {
        workletContext.runAsync(() => {
          'worklet'
          // The scene may have released these already when it unmounts together with the light
          if (scene?.isValid) scene.removeEntity(lightEntity)
          if (lightManager.isValid) lightManager.destroy(lightEntity)
        })
      })
    }
  }, [
    castShadows,
    initialColorKelvin,
    directionX,
    directionY,
    directionZ,
    falloffRadius,
    innerSpotLightCone,
    initialIntensity,
    lightManager,
    outerSpotLightCone,
    positionX,
    positionY,
    positionZ,
    scene,
    type,
    workletContext,
  ])

  // Subscribe to the intensity shared value
  useWorkletEffect(() => {
    'worklet'
    if (entity == null) return
    const intensity = config.intensity
    if (intensity == null) return
    if (typeof intensity === 'number') return

    const setIntensity = lightManager.setIntensity

    return intensity.addListener(
      workletContext.createRunAsync(() => {
        'worklet'
        setIntensity(entity, intensity.value)
      })
    )
  })

  // Subscribe to the colorKelvin shared value
  useWorkletEffect(() => {
    'worklet'
    if (entity == null) return
    const colorKelvin = config.colorKelvin
    if (colorKelvin == null) return
    if (typeof colorKelvin === 'number') return

    const setColor = lightManager.setColor

    return colorKelvin.addListener(
      workletContext.createRunAsync(() => {
        'worklet'
        setColor(entity, convertKelvinToLinearSRGB(colorKelvin.value))
      })
    )
  })

  return entity
}
