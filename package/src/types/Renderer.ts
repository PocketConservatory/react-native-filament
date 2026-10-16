import { PointerHolder } from './PointerHolder'
import { SwapChain } from './SwapChain'
import { View } from './View'

/**
 * Use FrameRateOptions to set the desired frame rate and control how quickly the system
 * reacts to GPU load changes.
 *
 * The parameters below are relevant when some Views are using dynamic resolution scaling:
 */
export interface FrameRateOptions {
  /**
   * Additional headroom for the GPU as a ratio of the targetFrameTime.
   * Useful for taking into account constant costs like post-processing or
   * GPU drivers on different platforms.
   * @default 0.0
   **/
  headRoomRatio?: number

  /**
   * Rate at which the gpu load is adjusted to reach the target frame rate
   * This value can be computed as 1 / N, where N is the number of frames
   * needed to reach 64% of the target scale factor.
   * Higher values make the dynamic resolution react faster.
   * @default 1/8
   **/
  scaleRate?: number

  /**
   * History size. Higher values tend to filter more (clamped to 31).
   * @default 15
   **/
  history?: number

  /**
   * Desired frame interval in multiple of the refresh period, set in DisplayInfo (as 1 / DisplayInfo::refreshRate)
   * @default 1
   **/
  interval?: number
}

/**
 * A `Renderer` instance represents an operating system's window.
 *
 * Typically, applications create a `Renderer` per window. The `Renderer` generates
 * drawing commands for the render thread and manages frame latency.
 *
 * A `Renderer` generates drawing commands from a `View`, itself containing a Scene description.
 */
export interface Renderer extends PointerHolder {
  /** Starts a bounded on-device alpha WebP export to an absolute cache path. */
  beginWebPExport(path: string, width: number, height: number, maxFrames: number): void
  /** Starts independent full-frame encoding with ordered muxing; up to eight frames can encode concurrently. */
  beginParallelWebPExport(path: string, width: number, height: number, maxFrames: number): void
  /** Captures at source dimensions and resizes with alpha weighting on native encoder workers. */
  beginResizedParallelWebPExport(
    path: string,
    captureWidth: number,
    captureHeight: number,
    outputWidth: number,
    outputHeight: number,
    maxFrames: number
  ): void
  /** Returns peak simultaneous independent encoder calls for the current or completed export. */
  getWebPExportPeakEncodingConcurrency(): number
  /** Returns the native bound on outstanding GPU readback/encode jobs. */
  getWebPExportMaxPendingFrames(): number
  /** Queues readback before endFrame; resolves after ordered encoding, with at most eight outstanding jobs. */
  captureWebPFrame(timestampMs: number): Promise<void>
  /** Ends the final frame at timestampMs and returns the completed file URI. */
  finishWebPExport(timestampMs: number): Promise<string>
  /** Cancels pending output; in-flight readback retains its own native resources. */
  cancelWebPExport(): void
  setFrameRateOptions: (options: FrameRateOptions) => void

  /**
   * Whether the View should be cleared using the clearColor. Use this if translucent
   * View will be drawn, for instance.
   * @default true
   */
  setClearContent: (clear: boolean) => void

  /**
   * Set the current Frame's output presentation timestamp, in milliseconds.
   */
  setPresentationTime: (timestamp: number) => void

  beginFrame: (swapChain: SwapChain, timestamp: number) => boolean
  render: (view: View) => void
  endFrame: () => void
}
