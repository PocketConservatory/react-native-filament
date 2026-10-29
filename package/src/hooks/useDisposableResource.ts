import { DependencyList, useEffect, useState } from 'react'
import { withCleanupScope } from '../utilities/withCleanupScope'
import { PointerHolder } from '../types/PointerHolder'
import type { IWorkletContext } from 'react-native-worklets-core'

type ReleasingResource = Pick<PointerHolder, 'release'>

function releaseOnContext(resource: ReleasingResource, workletContext: IWorkletContext) {
  withCleanupScope(() => {
    'worklet'
    // The resource may have been released natively or by another owner meanwhile
    if ((resource as Partial<PointerHolder>).isValid === false) return
    resource.release()
  }, workletContext)()
}

const emptyStaticArray: DependencyList = []

/**
 * Any resource that is a {@link PointerHolder} and can be released, should be loaded
 * using this hook. It takes care of properly releasing the resource when the component
 * unmounts or dependencies change.
 * There are certain cases like "fast refresh" or StrictMode that make useEffects execute
 * multiple times. Also loading the resource can be async and this hooks handles all these
 * cases properly.
 *
 * @param workletContext When given, the resource is released on this context (after already queued jobs), which
 * should be the context that uses it. Otherwise it is released on the JS thread.
 */
export const useDisposableResource = <T extends ReleasingResource>(
  initialize: () => Promise<T | undefined> | undefined,
  deps?: DependencyList,
  workletContext?: IWorkletContext
): T | undefined => {
  const [resource, setResource] = useState<T>()

  useEffect(() => {
    let isValid = true
    let currentAsset: T | undefined
    initialize()?.then((a) => {
      if (a == null) return

      if (isValid) {
        // this useEffect is still mounted
        setResource(a)
        currentAsset = a
      } else {
        // this useEffect has been unmounted already, drop the asset
        if (workletContext != null) releaseOnContext(a, workletContext)
        else a.release()
      }
    })
    // TODO: catch is broken
    // .catch((e) => {
    //   console.error('Error while loading resource', e)
    // })
    return () => {
      setResource(undefined)
      isValid = false
      if (currentAsset == null) return
      if (workletContext != null) {
        releaseOnContext(currentAsset, workletContext)
      } else {
        const asset = currentAsset
        withCleanupScope(() => {
          asset.release()
        })()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps ?? emptyStaticArray)

  return resource
}
