//! Audio engine — short synthesized tones for timer completions and UI feedback.
//!
//! All audio I/O happens on a dedicated thread that owns the `OutputStream`
//! and a persistent `Sink`. The rest of the app talks to it through a
//! `std::sync::mpsc` channel, so the audio device can never block IPC.
//!
//! Sounds are generated in code (no asset files): a two-note "ding" for
//! completion and a single short click for general UI feedback. This keeps
//! the bundle small and dependency-free at runtime.

use parking_lot::Mutex;
use rodio::source::{SineWave, Source};
use rodio::{OutputStream, Sink};
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone, Copy)]
pub enum AudioCmd {
    Completion,
    Click,
    SetVolume(f32),
    SetMuted(bool),
}

#[derive(Debug, Clone)]
pub struct AudioSettings {
    pub volume: f32,
    pub muted: bool,
    /// `false` if the audio thread failed to open an output device.
    pub available: bool,
}

impl Default for AudioSettings {
    fn default() -> Self {
        Self { volume: 0.55, muted: false, available: true }
    }
}

pub struct AudioEngine {
    tx: Sender<AudioCmd>,
    settings: Arc<Mutex<AudioSettings>>,
}

impl AudioEngine {
    /// Spawn the audio worker. Returns immediately; if the audio device can't
    /// be opened the engine becomes a no-op (`available = false`).
    pub fn spawn(initial: AudioSettings) -> Self {
        let (tx, rx) = channel::<AudioCmd>();
        let settings = Arc::new(Mutex::new(initial.clone()));
        let s_thread = settings.clone();

        thread::Builder::new()
            .name("nerva-audio".into())
            .spawn(move || {
                let (_stream, handle) = match OutputStream::try_default() {
                    Ok(x) => x,
                    Err(e) => {
                        tracing::warn!(error = %e, "audio: no output device — disabling");
                        s_thread.lock().available = false;
                        // Drain commands silently so senders don't block.
                        for _ in rx {}
                        return;
                    }
                };
                let sink = match Sink::try_new(&handle) {
                    Ok(s) => s,
                    Err(e) => {
                        tracing::warn!(error = %e, "audio: sink init failed — disabling");
                        s_thread.lock().available = false;
                        for _ in rx {}
                        return;
                    }
                };
                let mut volume = initial.volume.clamp(0.0, 1.0);
                let mut muted = initial.muted;
                sink.set_volume(volume);

                tracing::info!("audio: ready (volume={volume:.2}, muted={muted})");

                for cmd in rx {
                    match cmd {
                        AudioCmd::SetVolume(v) => {
                            volume = v.clamp(0.0, 1.0);
                            sink.set_volume(volume);
                        }
                        AudioCmd::SetMuted(m) => {
                            muted = m;
                            if muted {
                                sink.set_volume(0.0);
                            } else {
                                sink.set_volume(volume);
                            }
                        }
                        AudioCmd::Completion if !muted => {
                            // C5 → E5 two-note "ding", each with a short fade.
                            let a = SineWave::new(523.25)
                                .take_duration(Duration::from_millis(220))
                                .amplify(0.55)
                                .fade_in(Duration::from_millis(20));
                            let b = SineWave::new(659.26)
                                .take_duration(Duration::from_millis(360))
                                .amplify(0.55)
                                .fade_in(Duration::from_millis(20));
                            sink.append(a);
                            sink.append(b);
                        }
                        AudioCmd::Click if !muted => {
                            let s = SineWave::new(880.0)
                                .take_duration(Duration::from_millis(45))
                                .amplify(0.30);
                            sink.append(s);
                        }
                        _ => {}
                    }
                }
            })
            .expect("spawn audio thread");

        Self { tx, settings }
    }

    pub fn play_completion(&self) {
        let _ = self.tx.send(AudioCmd::Completion);
    }

    #[allow(dead_code)]
    pub fn play_click(&self) {
        let _ = self.tx.send(AudioCmd::Click);
    }

    pub fn set_volume(&self, v: f32) {
        self.settings.lock().volume = v.clamp(0.0, 1.0);
        let _ = self.tx.send(AudioCmd::SetVolume(v));
    }

    pub fn set_muted(&self, m: bool) {
        self.settings.lock().muted = m;
        let _ = self.tx.send(AudioCmd::SetMuted(m));
    }

    pub fn snapshot(&self) -> AudioSettings {
        self.settings.lock().clone()
    }
}
