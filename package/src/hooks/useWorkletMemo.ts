import { useEffect, useState } from 'react'
import { useFilamentContext } from './useFilamentContext'
import { wrapWithErrorHandler } from '../ErrorUtils'
import { RenderCallbackContext } from '../react/RenderCallbackContext'

export function useWorkletMemo<T>(workletFunction: () => T, dependencies: any[]): T | undefined {
  const { workletContext } = useFilamentContext()
  const { contextId } = RenderCallbackContext.useRenderContext()
  const [value, setValue] = useState<T | undefined>(undefined)

  useEffect(
    () => {
      workletContext.runAsync(wrapWithErrorHandler(workletFunction, contextId)).then(
        (result) => setValue(result),
        // Already reported by wrapWithErrorHandler
        () => undefined
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    dependencies
  )

  return value
}
