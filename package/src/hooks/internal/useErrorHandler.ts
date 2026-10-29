import { useEffect, useRef } from 'react'
import { addErrorHandler, FilamentErrorHandler } from '../../ErrorUtils'

/**
 * Delivers the errors of `contextId` to the latest `onError` while it is set. The handler is registered once per
 * context, not again for every new `onError` identity.
 */
export function useErrorHandler(contextId: number, onError: FilamentErrorHandler | undefined) {
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onErrorRef.current = onError
  })

  const hasHandler = onError != null
  useEffect(() => {
    if (!hasHandler) return
    return addErrorHandler(contextId, (error) => onErrorRef.current?.(error))
  }, [contextId, hasHandler])
}
