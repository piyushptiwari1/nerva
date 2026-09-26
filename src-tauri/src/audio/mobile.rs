//! Mobile audio engine — a no-op with the same surface as the desktop one.
//!
//! Android/iOS builds don't link rodio/cpal (the Android backend needs the
//! NDK C++ toolchain and a JNI context). Timer cues are delivered as OS
//! notifications from the frontend instead, so the settings UI still works
//! but `available` is `false` and the audio tab shows "not on this device".

use super::{AmbientKind, AudioSettings, CompletionSound};
use parking_lot::Mutex;

pub struct AudioEngine {
    settings: Mutex<AudioSettings>,
}

impl AudioEngine {
    pub fn spawn(initial: AudioSettings) -> Self {
        let mut s = initial;
        s.available = false;
        Self {
            settings: Mutex::new(s),
        }
    }

    pub fn play_completion(&self) {}
    pub fn play_break_start(&self) {}
    pub fn play_focus_start(&self) {}
    pub fn play_resume(&self) {}
    #[allow(dead_code)]
    pub fn play_click(&self) {}

    pub fn set_volume(&self, v: f32) {
        self.settings.lock().volume = v.clamp(0.0, 1.0);
    }

    pub fn set_muted(&self, m: bool) {
        self.settings.lock().muted = m;
    }

    pub fn set_sound(&self, s: CompletionSound) {
        self.settings.lock().sound = s;
    }

    pub fn snapshot(&self) -> AudioSettings {
        self.settings.lock().clone()
    }

    pub fn start_ambient(&self, kind: AmbientKind) {
        self.settings.lock().ambient = Some(kind);
    }

    pub fn stop_ambient(&self) {
        self.settings.lock().ambient = None;
    }

    pub fn set_ambient_volume(&self, v: f32) {
        self.settings.lock().ambient_volume = v.clamp(0.0, 1.0);
    }
}
