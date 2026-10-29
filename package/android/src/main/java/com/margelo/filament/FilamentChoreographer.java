package com.margelo.filament;

import android.util.Log;
import android.view.Choreographer;

import androidx.annotation.Keep;

import com.facebook.jni.HybridData;
import com.facebook.proguard.annotations.DoNotStrip;

/**
 * @noinspection JavaJniMissingFunction
 */
public class FilamentChoreographer {
    /**
     * @noinspection unused, FieldCanBeLocal
     */
    @DoNotStrip
    @Keep
    private final HybridData mHybridData;
    private final Choreographer choreographer;
    // Keep one callback instance: a new method reference per call would make removeFrameCallback() a no-op.
    private final Choreographer.FrameCallback frameCallback = this::onFrameCallback;
    private volatile boolean isRunning;

    public FilamentChoreographer() {
        mHybridData = initHybrid();
        choreographer = Choreographer.getInstance();
    }

    private void onFrameCallback(long timestamp) {
        if (!isRunning) return;
        onFrame(timestamp);
        postNextFrame();
    }

    // Removing first guarantees a single pending callback, even when start() raced with a running frame.
    private synchronized void postNextFrame() {
        if (!isRunning) return;
        choreographer.removeFrameCallback(frameCallback);
        choreographer.postFrameCallback(frameCallback);
    }

    /**
     * @noinspection unused
     */
    @DoNotStrip
    @Keep
    private synchronized void start() {
        if (!isRunning) {
            isRunning = true;
            postNextFrame();
            Log.d("FilamentChoreographer", "Started choreographer!");
        }
    }

    /**
     * @noinspection unused
     */
    @DoNotStrip
    @Keep
    private synchronized void stop() {
        if (isRunning) {
            isRunning = false;
            choreographer.removeFrameCallback(frameCallback);
            Log.d("FilamentChoreographer", "Stopped choreographer!");
        }
    }

    private native HybridData initHybrid();

    private native void onFrame(long timestamp);
}
