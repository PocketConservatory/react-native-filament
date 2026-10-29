import { Worklets, type IWorkletContext } from 'react-native-worklets-core'

/**
 * Receives Filament errors of a scene on the JS thread instead of reporting them as fatal errors.
 */
export type FilamentErrorHandler = (error: Error) => void

/**
 * Errors that are not reported for a specific scene use this context id.
 */
export const NO_CONTEXT_ID = -1

const errorHandlers = new Map<number, Set<FilamentErrorHandler>>()
// Contexts that registered a handler once. Their errors stay non-fatal after the handler is removed, as errors
// can still arrive from the worklet thread after unmount.
const nonFatalContextIds = new Set<number>()

/**
 * Registers `handler` for the errors of the given context id and returns a function that removes it.
 * While a context has a handler, its errors are delivered to the handler instead of being reported as fatal.
 */
export function addErrorHandler(contextId: number, handler: FilamentErrorHandler): () => void {
  nonFatalContextIds.add(contextId)
  let handlers = errorHandlers.get(contextId)
  if (handlers == null) {
    handlers = new Set()
    errorHandlers.set(contextId, handlers)
  }
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
    if (handlers.size === 0 && errorHandlers.get(contextId) === handlers) errorHandlers.delete(contextId)
  }
}

/**
 * Report an error to react native's `ErrorUtils` if available, or log to console otherwise.
 */
export function reportError(error: unknown, fatal: boolean): void {
  // @ts-expect-error this is defined by react-native.
  if (global.ErrorUtils != null) {
    if (fatal) {
      // @ts-expect-error this is defined by react-native.
      global.ErrorUtils.reportFatalError(error)
    } else {
      // @ts-expect-error this is defined by react-native.
      global.ErrorUtils.reportError(error)
    }
  } else {
    console.error(`An unknown Filament error occurred!`, error)
  }
}

function dispatchError(error: Error, fatal: boolean, contextId: number): void {
  const handlers = errorHandlers.get(contextId)
  if (handlers != null && handlers.size > 0) {
    for (const handler of [...handlers]) {
      try {
        handler(error)
      } catch (handlerError) {
        reportError(handlerError, false)
      }
    }
    return
  }
  reportError(error, fatal && !nonFatalContextIds.has(contextId))
}

const throwErrorOnJS = Worklets.createRunOnJS((message: string, stack: string | undefined, fatal: boolean, contextId: number) => {
  const error = new Error()
  error.message = message
  error.stack = stack
  error.name = 'Filament Error'
  // @ts-expect-error this is react-native specific
  error.jsEngine = 'Filament'
  dispatchError(error, fatal, contextId)
})

/**
 * Reports an error from a worklet on the JS thread. If the scene of `contextId` has an `onError` handler, the error
 * goes to that handler. Otherwise it is reported to react native's `ErrorUtils`, as a fatal error unless `fatal` is
 * false. An error is reported at most once, even when it is rethrown and caught again.
 */
export const reportWorkletError = (error: unknown, fatal = true, contextId: number = NO_CONTEXT_ID): void => {
  'worklet'
  const safeError = error as (Error & { __rnfReported?: boolean }) | undefined
  if (safeError != null && typeof safeError === 'object') {
    if (safeError.__rnfReported === true) return
    try {
      safeError.__rnfReported = true
    } catch {
      // Frozen error objects can't be marked, report them anyway
    }
  }
  const message = safeError != null && 'message' in safeError ? safeError.message : 'Filament threw an error.'
  throwErrorOnJS(message, safeError?.stack, fatal, contextId)
}

/**
 * Whether the error was thrown because a native object was used after it had been released.
 */
export const isReleasedPointerError = (error: unknown): boolean => {
  'worklet'
  const message = error != null && typeof error === 'object' && 'message' in error ? String(error.message) : ''
  return message.includes('has already been manually released')
}

export const wrapWithErrorHandler = <T extends (...args: any[]) => any>(
  callback: T,
  contextId: number = NO_CONTEXT_ID
): ((...args: Parameters<T>) => ReturnType<T>) => {
  return (...args: Parameters<T>): ReturnType<T> => {
    'worklet'
    try {
      return callback(...args)
    } catch (error) {
      reportWorkletError(error, true, contextId)
      throw error
    }
  }
}

/**
 * Runs `job` (a worklet) on `workletContext` without handling its result on the JS thread. A throw is reported with
 * {@linkcode reportWorkletError} for `contextId`, so it is fatal unless that context has an `onError` handler.
 * With `ignoreReleased`, errors from using an already released object are dropped, which is teardown noise.
 * @returns The job's result, or `undefined` if it threw. The promise never rejects.
 */
export function runOnWorkletContext<T>(
  workletContext: IWorkletContext,
  contextId: number,
  job: () => T,
  { ignoreReleased = false }: { ignoreReleased?: boolean } = {}
): Promise<T | undefined> {
  return workletContext
    .runAsync(() => {
      'worklet'
      try {
        return job()
      } catch (error) {
        if (!(ignoreReleased && isReleasedPointerError(error))) reportWorkletError(error, true, contextId)
        return undefined
      }
    })
    .catch(() => undefined)
}
