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
use serde::{Deserialize, Serialize};
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

/// Kinds of background noise we synthesize. No audio files shipped — every
/// kind is generated procedurally so the bundle stays tiny and the user can't
/// run out of "tracks". Pink and brown are the classic focus colors; white is
/// included mostly as a calibration reference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AmbientKind {
    White,
    Pink,
    Brown,
}

#[derive(Debug, Clone, Copy)]
pub enum AudioCmd {
    Completion,
    Click,
    SetVolume(f32),
    SetMuted(bool),
    AmbientStart(AmbientKind),
    AmbientStop,
    AmbientVolume(f32),
}

#[derive(Debug, Clone)]
pub struct AudioSettings {
    pub volume: f32,
    pub muted: bool,
    /// `false` if the audio thread failed to open an output device.
    pub available: bool,
    /// Currently-playing ambient noise, or `None` if silent.
    pub ambient: Option<AmbientKind>,
    /// Independent volume scalar for ambient noise (0..1). Decoupled from the
    /// completion-ding volume so users can keep alerts loud while running
    /// background noise at a whisper.
    pub ambient_volume: f32,
}

impl Default for AudioSettings {
    fn default() -> Self {
        Self {
            volume: 0.55,
            muted: false,
            available: true,
            ambient: None,
            ambient_volume: 0.25,
        }
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
                // Separate sink for looping ambient noise so it doesn't queue
                // behind one-shot dings (rodio sinks serialize their sources).
                let ambient_sink = match Sink::try_new(&handle) {
                    Ok(s) => s,
                    Err(e) => {
                        tracing::warn!(error = %e, "audio: ambient sink init failed");
                        // Still continue with just the main sink; ambient
                        // commands will be no-ops.
                        for _ in rx {}
                        return;
                    }
                };
                let mut volume = initial.volume.clamp(0.0, 1.0);
                let mut muted = initial.muted;
                let mut ambient_volume = initial.ambient_volume.clamp(0.0, 1.0);
                sink.set_volume(volume);
                ambient_sink.set_volume(if muted { 0.0 } else { ambient_volume });

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
                                ambient_sink.set_volume(0.0);
                            } else {
                                sink.set_volume(volume);
                                ambient_sink.set_volume(ambient_volume);
                            }
                        }
                        AudioCmd::AmbientStart(kind) => {
                            // Clear any previously queued ambient source then
                            // append a fresh infinite generator. Sink keeps
                            // playing in the background; we never block.
                            ambient_sink.clear();
                            ambient_sink.append(NoiseSource::new(kind));
                            ambient_sink.play();
                        }
                        AudioCmd::AmbientStop => {
                            ambient_sink.clear();
                        }
                        AudioCmd::AmbientVolume(v) => {
                            ambient_volume = v.clamp(0.0, 1.0);
                            if !muted {
                                ambient_sink.set_volume(ambient_volume);
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

    pub fn start_ambient(&self, kind: AmbientKind) {
        self.settings.lock().ambient = Some(kind);
        let _ = self.tx.send(AudioCmd::AmbientStart(kind));
    }

    pub fn stop_ambient(&self) {
        self.settings.lock().ambient = None;
        let _ = self.tx.send(AudioCmd::AmbientStop);
    }

    pub fn set_ambient_volume(&self, v: f32) {
        let v = v.clamp(0.0, 1.0);
        self.settings.lock().ambient_volume = v;
        let _ = self.tx.send(AudioCmd::AmbientVolume(v));
    }
}

// ---------- procedural noise generator ----------

/// Infinite mono `Source` that streams white / pink / brown noise samples.
///
/// Pink noise uses the Paul Kellet refined coefficients — a 7-pole IIR
/// approximation that's effectively indistinguishable from "true" 1/f noise
/// for human listening and costs ~30 multiplies per sample. Brown noise is
/// integrated white with a small leak factor so the DC offset can't drift
/// indefinitely.
///
/// The PRNG is a tiny xorshift64 — no `rand` dependency, deterministic enough
/// to never repeat audibly within a focus session.
pub struct NoiseSource {
    kind: AmbientKind,
    rng_state: u64,
    sample_rate: u32,
    // Pink-noise state (Paul Kellet coefficients).
    b0: f32, b1: f32, b2: f32, b3: f32, b4: f32, b5: f32, b6: f32,
    // Brown-noise running sum.
    brown_last: f32,
}

impl NoiseSource {
    pub fn new(kind: AmbientKind) -> Self {
        Self {
            kind,
            // Cheap, non-zero seed; not a security RNG.
            rng_state: 0x9E37_79B9_7F4A_7C15,
            sample_rate: 44_100,
            b0: 0.0, b1: 0.0, b2: 0.0, b3: 0.0, b4: 0.0, b5: 0.0, b6: 0.0,
            brown_last: 0.0,
        }
    }

    #[inline]
    fn next_white(&mut self) -> f32 {
        // xorshift64*
        let mut x = self.rng_state;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.rng_state = x;
        let v = x.wrapping_mul(0x2545_F491_4F6C_DD1D);
        // Map top 24 bits to [-1, 1].
        ((v >> 40) as i32 as f32) / (1 << 23) as f32
    }
}

impl Iterator for NoiseSource {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        let white = self.next_white();
        let s = match self.kind {
            AmbientKind::White => white * 0.5,
            AmbientKind::Pink => {
                // Paul Kellet refined pink-noise filter.
                self.b0 = 0.99886 * self.b0 + white * 0.0555179;
                self.b1 = 0.99332 * self.b1 + white * 0.0750759;
                self.b2 = 0.96900 * self.b2 + white * 0.1538520;
                self.b3 = 0.86650 * self.b3 + white * 0.3104856;
                self.b4 = 0.55000 * self.b4 + white * 0.5329522;
                self.b5 = -0.7616 * self.b5 - white * 0.0168980;
                let pink = self.b0 + self.b1 + self.b2 + self.b3
                    + self.b4 + self.b5 + self.b6 + white * 0.5362;
                self.b6 = white * 0.115926;
                pink * 0.11
            }
            AmbientKind::Brown => {
                // Integrated white + small leak so DC can't drift.
                let next = (self.brown_last + 0.02 * white) * 0.9995;
                let clamped = next.clamp(-1.0, 1.0);
                self.brown_last = clamped;
                clamped * 3.5
            }
        };
        Some(s.clamp(-1.0, 1.0))
    }
}

impl Source for NoiseSource {
    fn current_frame_len(&self) -> Option<usize> { None }
    fn channels(&self) -> u16 { 1 }
    fn sample_rate(&self) -> u32 { self.sample_rate }
    fn total_duration(&self) -> Option<Duration> { None }
}
