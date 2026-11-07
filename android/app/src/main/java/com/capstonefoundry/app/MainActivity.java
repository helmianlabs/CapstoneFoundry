package com.capstonefoundry.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import java.util.List;

public class MainActivity extends BridgeActivity {

    private static final int MIC_REQUEST_CODE = 7301;
    private AudioManager audioManager;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        setupAudioRouting();

        // The voice widget runs inside the WebView and can only capture
        // audio once the Android microphone permission is granted at the
        // OS level. Ask for it up front, at launch, so the permission is
        // settled before the first call. Without this, the widget's
        // in-call request could fail silently (no prompt ever shown) and
        // every conversation died at 0 seconds (proven 2026-11-04:
        // ElevenLabs recorded the attempts as failed, 0 messages).
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this,
                    new String[] {
                            Manifest.permission.RECORD_AUDIO,
                            Manifest.permission.MODIFY_AUDIO_SETTINGS
                    },
                    MIC_REQUEST_CODE);
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        // Allow WebAudio and media playback without requiring direct user gesture per element
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
        }
        enforceSpeakerRouting();
    }

    @Override
    public void onResume() {
        super.onResume();
        enforceSpeakerRouting();
    }

    private void setupAudioRouting() {
        if (audioManager == null) return;
        enforceSpeakerRouting();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                audioManager.addOnModeChangedListener(
                        getMainExecutor(),
                        mode -> {
                            if (mode == AudioManager.MODE_IN_COMMUNICATION || mode == AudioManager.MODE_IN_CALL) {
                                enforceSpeakerRouting();
                            }
                        }
                );
                audioManager.addOnCommunicationDeviceChangedListener(
                        getMainExecutor(),
                        device -> {
                            if (device != null && device.getType() == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) {
                                enforceSpeakerRouting();
                            }
                        }
                );
            } catch (Exception ignored) {}
        }
    }

    private void enforceSpeakerRouting() {
        if (audioManager == null) return;
        try {
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            audioManager.setSpeakerphoneOn(true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();
                for (AudioDeviceInfo device : devices) {
                    if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                        audioManager.setCommunicationDevice(device);
                        break;
                    }
                }
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onBackPressed() {
        // Check if an in-app overlay (artifact previewer, gallery modal, lightbox) is open
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().evaluateJavascript(
                "(function() { " +
                "  if (typeof window.__cfHandleHardwareBack === 'function' && window.__cfHandleHardwareBack()) { return 'handled'; } " +
                "  return 'unhandled'; " +
                "})()",
                value -> {
                    if (!"\"handled\"".equals(value)) {
                        MainActivity.super.onBackPressed();
                    }
                }
            );
            return;
        }
        super.onBackPressed();
    }
}
