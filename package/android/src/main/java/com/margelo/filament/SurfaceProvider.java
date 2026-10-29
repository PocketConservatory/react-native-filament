package com.margelo.filament;

import androidx.annotation.Keep;

import com.facebook.jni.HybridData;
import com.facebook.proguard.annotations.DoNotStrip;

/**
 * @noinspection JavaJniMissingFunction
 */
public class SurfaceProvider {
    /**
     * @noinspection unused, FieldCanBeLocal
     */
    @DoNotStrip
    @Keep
    private final HybridData mHybridData;

    SurfaceProvider() {
        mHybridData = initHybrid();
    }

    private native HybridData initHybrid();

    public native void onSurfaceCreated(Object surface);

    public native void onSurfaceChanged(Object surface, int width, int height);

    /**
     * @param releaseSurface Called once Filament no longer uses the surface, possibly on another thread.
     */
    public native void onSurfaceDestroyed(Object surface, Runnable releaseSurface);
}
