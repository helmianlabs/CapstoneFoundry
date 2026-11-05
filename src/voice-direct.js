// Direct voice bridge (2026-11-04 night).
//
// Exposes the ElevenLabs client SDK to the page so the app can run
// voice sessions ITSELF instead of through the hosted widget. Inside
// the Android app window the widget's two transports each break a
// different direction (WebRTC: silent microphone track; websocket:
// playback engine starts asleep) — full trace in the 2026-11-04 memory
// log. Driving the SDK directly lets the app own the call button, the
// session config, and the audio lifecycle.
//
// The monolith (index.html) builds the session config through the very
// same elevenlabs-convai:call handler the widget uses; this module
// only carries the SDK across the bundle boundary.
import { Conversation } from '@elevenlabs/client';

window.__cfVoice = {
  startSession: (options) => Conversation.startSession(options),
};
