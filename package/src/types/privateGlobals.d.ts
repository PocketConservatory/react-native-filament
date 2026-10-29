import type { RenderCallback } from './Choreographer'

declare global {
  var __listenerRegistry: Record<number, Array<() => void>> | undefined
  var __rnfRenderCallbacks: Record<number, Map<number, RenderCallback>> | undefined
}
