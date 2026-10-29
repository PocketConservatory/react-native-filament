import { UseLightEntityProps, useLightEntityInScene } from '../hooks/useLightEntity'
import { useFilamentContext } from '../hooks/useFilamentContext'

export type LightProps = UseLightEntityProps

export function Light(config: LightProps) {
  const { lightManager, scene } = useFilamentContext()

  useLightEntityInScene(lightManager, config, scene)

  return null
}
