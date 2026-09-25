//! Audio engine — short synthesized cues for timer phases and UI feedback.
//!
//! All audio I/O happens on a dedicated thread that owns the `OutputStream`
//! and a persistent `Sink`. The rest of the app talks to it through a
//! `std::sync::mpsc` channel, so the audio device can never block IPC.
//!
//! Sounds are generated in code (no asset files) by a tiny additive synth
//! (see `render`): session-complete, break-start, focus-start and resume
//! cues are each a distinct musical figure so users can tell them apart
//! without looking. This keeps the bundle small and dependency-free at
//! runtime.

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

/// Completion-ding flavours. All synthesized — no audio assets shipped.
/// `Classic` is the historical C5→E5 two-note ding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum CompletionSound {
    #[default]
    Classic,
    Chime,
    Bell,
    Beep,
    Soft,
}

impl CompletionSound {
    pub fn from_label(s: &str) -> Option<Self> {
        match s {
            "classic" => Some(Self::Classic),
            "chime" => Some(Self::Chime),
            "bell" => Some(Self::Bell),
            "beep" => Some(Self::Beep),
            "soft" => Some(Self::Soft),
            _ => None,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Self::Classic => "classic",
            Self::Chime => "chime",
            Self::Bell => "bell",
            Self::Beep => "beep",
            Self::Soft => "soft",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub enum AudioCmd {
    /// Whole session finished.
    Completion,
    /// A focus phase ended → break begins ("relax" cue).
    BreakStart,
    /// A break ended → focus resumes ("go" cue).
    FocusStart,
    /// User resumed / restarted a timer (tiny confirmation).
    Resume,
    Click,
    SetVolume(f32),
    SetMuted(bool),
    SetSound(CompletionSound),
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
    /// Which completion ding to play when a timer hits zero.
    pub sound: CompletionSound,
}

impl Default for AudioSettings {
    fn default() -> Self {
        Self {
            volume: 0.55,
            muted: false,
            available: true,
            ambient: None,
            ambient_volume: 0.25,
            sound: CompletionSound::default(),
        }
    }
}

// ---------- additive synth ----------
//
// Every cue is rendered offline into a short f32 buffer by summing a handful
// of exponentially-decaying partials per note. Compared with the previous
// raw `SineWave` beeps this gives a struck-bell/chime character (a real
// attack transient, harmonics that die at different rates, overlapping
// tails between notes) while still shipping zero audio assets and no codec
// dependencies. Rendering ~1.5 s of audio costs well under a millisecond.

const SR: u32 = 44_100;

/// Which partial recipe a note uses.
#[derive(Debug, Clone, Copy)]
enum Timbre {
    /// Warm harmonic chime — glockenspiel-like, the new default.
    Chime,
    /// Inharmonic partials — a real struck bell with a long shimmer.
    Bell,
    /// Gentle sine + faint octave, very long tail.
    Soft,
    /// Crisp odd-harmonic digital beep, short and flat.
    Beep,
}

impl Timbre {
    /// `(frequency ratio, relative amplitude, decay time-constant seconds)`.
    fn partials(self) -> &'static [(f32, f32, f32)] {
        match self {
            Timbre::Chime => &[
                (1.0, 1.00, 0.55),
                (2.0, 0.45, 0.32),
                (3.0, 0.22, 0.20),
                (4.0, 0.10, 0.14),
                (5.4, 0.06, 0.10),
            ],
            Timbre::Bell => &[
                (0.56, 0.35, 1.30),
                (1.00, 1.00, 1.10),
                (1.19, 0.30, 0.65),
                (1.71, 0.28, 0.55),
                (2.00, 0.26, 0.45),
                (2.74, 0.18, 0.32),
                (3.00, 0.10, 0.28),
                (3.76, 0.06, 0.20),
            ],
            Timbre::Soft => &[(1.0, 1.0, 0.75), (2.0, 0.12, 0.40)],
            Timbre::Beep => &[(1.0, 1.0, 0.09), (3.0, 0.30, 0.07), (5.0, 0.12, 0.05)],
        }
    }
    /// Attack length in ms — bells ring instantly, soft tones swell.
    fn attack_ms(self) -> f32 {
        match self {
            Timbre::Soft => 18.0,
            Timbre::Beep => 3.0,
            _ => 4.0,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct Note {
    onset_ms: f32,
    freq: f32,
    /// Audible length; tail is cut with a short fade so it never clicks.
    dur_ms: f32,
    amp: f32,
    timbre: Timbre,
}

/// Render a set of possibly-overlapping notes into a mono sample buffer,
/// peak-normalised to `peak` so louder recipes can't clip.
fn render(notes: &[Note], peak: f32) -> rodio::buffer::SamplesBuffer<f32> {
    let total_ms = notes
        .iter()
        .map(|n| n.onset_ms + n.dur_ms)
        .fold(0.0_f32, f32::max)
        + 30.0;
    let n_samples = ((total_ms / 1000.0) * SR as f32).ceil() as usize;
    let mut buf = vec![0.0_f32; n_samples];
    let two_pi = std::f32::consts::TAU;
    for n in notes {
        let start = ((n.onset_ms / 1000.0) * SR as f32) as usize;
        let len = ((n.dur_ms / 1000.0) * SR as f32) as usize;
        let attack = ((n.timbre.attack_ms() / 1000.0) * SR as f32).max(1.0);
        let fade = ((0.025 * SR as f32) as usize).min(len / 2).max(1);
        for i in 0..len {
            let idx = start + i;
            if idx >= buf.len() {
                break;
            }
            let t = i as f32 / SR as f32;
            let mut s = 0.0_f32;
            for &(ratio, a, decay) in n.timbre.partials() {
                s += a * (-t / decay).exp() * (two_pi * n.freq * ratio * t).sin();
            }
            let env_in = (i as f32 / attack).min(1.0);
            let env_out = if i + fade >= len {
                (len - i) as f32 / fade as f32
            } else {
                1.0
            };
            buf[idx] += s * n.amp * env_in * env_out;
        }
    }
    let max = buf.iter().fold(0.0_f32, |m, v| m.max(v.abs()));
    if max > 0.0 {
        let g = peak / max;
        for v in buf.iter_mut() {
            *v *= g;
        }
    }
    rodio::buffer::SamplesBuffer::new(1, SR, buf)
}

// Note frequencies (Hz).
const C5: f32 = 523.25;
const E5: f32 = 659.26;
const G5: f32 = 783.99;
const A5: f32 = 880.0;
const C6: f32 = 1046.5;
const A4: f32 = 440.0;

/// Map the user's chosen family onto a timbre for the phase cues so a
/// "bell" user hears bell-flavoured breaks too.
fn timbre_for(sound: CompletionSound) -> Timbre {
    match sound {
        CompletionSound::Classic | CompletionSound::Chime => Timbre::Chime,
        CompletionSound::Bell => Timbre::Bell,
        CompletionSound::Beep => Timbre::Beep,
        CompletionSound::Soft => Timbre::Soft,
    }
}

/// Session finished. Each family is a short, resolved musical figure —
/// descending or landing on the tonic so it reads as "done", not "alert".
fn append_completion(sink: &Sink, sound: CompletionSound) {
    let notes: Vec<Note> = match sound {
        CompletionSound::Classic => vec![
            // G5 → E5 → C5, tails overlapping into a warm major-chord wash.
            Note {
                onset_ms: 0.0,
                freq: G5,
                dur_ms: 900.0,
                amp: 0.9,
                timbre: Timbre::Chime,
            },
            Note {
                onset_ms: 220.0,
                freq: E5,
                dur_ms: 900.0,
                amp: 0.85,
                timbre: Timbre::Chime,
            },
            Note {
                onset_ms: 440.0,
                freq: C5,
                dur_ms: 1300.0,
                amp: 1.0,
                timbre: Timbre::Chime,
            },
        ],
        CompletionSound::Chime => vec![
            // Ascending C5 E5 G5 C6 arpeggio — brighter, celebratory.
            Note {
                onset_ms: 0.0,
                freq: C5,
                dur_ms: 700.0,
                amp: 0.8,
                timbre: Timbre::Chime,
            },
            Note {
                onset_ms: 150.0,
                freq: E5,
                dur_ms: 700.0,
                amp: 0.8,
                timbre: Timbre::Chime,
            },
            Note {
                onset_ms: 300.0,
                freq: G5,
                dur_ms: 800.0,
                amp: 0.85,
                timbre: Timbre::Chime,
            },
            Note {
                onset_ms: 450.0,
                freq: C6,
                dur_ms: 1200.0,
                amp: 1.0,
                timbre: Timbre::Chime,
            },
        ],
        CompletionSound::Bell => vec![
            // Two strikes of a real bell, second softer, long shimmer.
            Note {
                onset_ms: 0.0,
                freq: A5,
                dur_ms: 1800.0,
                amp: 1.0,
                timbre: Timbre::Bell,
            },
            Note {
                onset_ms: 650.0,
                freq: A5,
                dur_ms: 1800.0,
                amp: 0.6,
                timbre: Timbre::Bell,
            },
        ],
        CompletionSound::Beep => vec![
            // Triple digital beep — cuts through a noisy room.
            Note {
                onset_ms: 0.0,
                freq: 1000.0,
                dur_ms: 110.0,
                amp: 1.0,
                timbre: Timbre::Beep,
            },
            Note {
                onset_ms: 180.0,
                freq: 1000.0,
                dur_ms: 110.0,
                amp: 1.0,
                timbre: Timbre::Beep,
            },
            Note {
                onset_ms: 360.0,
                freq: 1250.0,
                dur_ms: 220.0,
                amp: 1.0,
                timbre: Timbre::Beep,
            },
        ],
        CompletionSound::Soft => vec![
            // A4 with a faint fifth above, slow swell, long tail.
            Note {
                onset_ms: 0.0,
                freq: A4,
                dur_ms: 1600.0,
                amp: 1.0,
                timbre: Timbre::Soft,
            },
            Note {
                onset_ms: 120.0,
                freq: E5,
                dur_ms: 1400.0,
                amp: 0.35,
                timbre: Timbre::Soft,
            },
        ],
    };
    sink.append(render(&notes, 0.85));
}

/// Focus phase ended → break. Two descending notes ("and… relax"), a touch
/// quieter than completion so it never startles mid-flow.
fn append_break_start(sink: &Sink, sound: CompletionSound) {
    let t = timbre_for(sound);
    let notes = [
        Note {
            onset_ms: 0.0,
            freq: E5,
            dur_ms: 700.0,
            amp: 0.8,
            timbre: t,
        },
        Note {
            onset_ms: 260.0,
            freq: C5,
            dur_ms: 1000.0,
            amp: 1.0,
            timbre: t,
        },
    ];
    sink.append(render(&notes, 0.7));
}

/// Break ended → back to focus. Two ascending notes ("ready, go"), crisp.
fn append_focus_start(sink: &Sink, sound: CompletionSound) {
    let t = timbre_for(sound);
    let notes = [
        Note {
            onset_ms: 0.0,
            freq: C5,
            dur_ms: 500.0,
            amp: 0.8,
            timbre: t,
        },
        Note {
            onset_ms: 200.0,
            freq: G5,
            dur_ms: 900.0,
            amp: 1.0,
            timbre: t,
        },
    ];
    sink.append(render(&notes, 0.75));
}

/// Single short, quiet confirmation for resume/restart.
fn append_resume(sink: &Sink, sound: CompletionSound) {
    let notes = [Note {
        onset_ms: 0.0,
        freq: A5,
        dur_ms: 260.0,
        amp: 1.0,
        timbre: timbre_for(sound),
    }];
    sink.append(render(&notes, 0.45));
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
                let mut sound = initial.sound;
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
                        AudioCmd::SetSound(s) => {
                            sound = s;
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
                            append_completion(&sink, sound);
                        }
                        AudioCmd::BreakStart if !muted => {
                            append_break_start(&sink, sound);
                        }
                        AudioCmd::FocusStart if !muted => {
                            append_focus_start(&sink, sound);
                        }
                        AudioCmd::Resume if !muted => {
                            append_resume(&sink, sound);
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

    pub fn play_break_start(&self) {
        let _ = self.tx.send(AudioCmd::BreakStart);
    }

    pub fn play_focus_start(&self) {
        let _ = self.tx.send(AudioCmd::FocusStart);
    }

    pub fn play_resume(&self) {
        let _ = self.tx.send(AudioCmd::Resume);
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

    pub fn set_sound(&self, s: CompletionSound) {
        self.settings.lock().sound = s;
        let _ = self.tx.send(AudioCmd::SetSound(s));
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
    b0: f32,
    b1: f32,
    b2: f32,
    b3: f32,
    b4: f32,
    b5: f32,
    b6: f32,
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
            b0: 0.0,
            b1: 0.0,
            b2: 0.0,
            b3: 0.0,
            b4: 0.0,
            b5: 0.0,
            b6: 0.0,
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
                self.b2 = 0.96900 * self.b2 + white * 0.153_852;
                self.b3 = 0.86650 * self.b3 + white * 0.3104856;
                self.b4 = 0.55000 * self.b4 + white * 0.5329522;
                self.b5 = -0.7616 * self.b5 - white * 0.0168980;
                let pink = self.b0
                    + self.b1
                    + self.b2
                    + self.b3
                    + self.b4
                    + self.b5
                    + self.b6
                    + white * 0.5362;
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
    fn current_frame_len(&self) -> Option<usize> {
        None
    }
    fn channels(&self) -> u16 {
        1
    }
    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }
    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

#[cfg(test)]
mod synth_tests {
    use super::*;

    fn samples(notes: &[Note], peak: f32) -> Vec<f32> {
        render(notes, peak).collect()
    }

    #[test]
    fn render_is_peak_normalised_and_click_free() {
        let notes = [
            Note {
                onset_ms: 0.0,
                freq: G5,
                dur_ms: 900.0,
                amp: 0.9,
                timbre: Timbre::Chime,
            },
            Note {
                onset_ms: 220.0,
                freq: E5,
                dur_ms: 900.0,
                amp: 0.85,
                timbre: Timbre::Chime,
            },
            Note {
                onset_ms: 440.0,
                freq: C5,
                dur_ms: 1300.0,
                amp: 1.0,
                timbre: Timbre::Bell,
            },
        ];
        let s = samples(&notes, 0.85);
        let peak = s.iter().fold(0.0_f32, |m, v| m.max(v.abs()));
        assert!((peak - 0.85).abs() < 1e-3, "peak {peak}");
        // First and last samples sit at (near) zero: attack ramp + tail fade.
        assert!(s[0].abs() < 1e-3);
        assert!(s.last().unwrap().abs() < 1e-3);
        // Length covers the last note + 30 ms pad.
        let expected = ((440.0 + 1300.0 + 30.0) / 1000.0 * SR as f32).ceil() as usize;
        assert_eq!(s.len(), expected);
    }

    #[test]
    fn every_family_renders_for_every_cue() {
        for sound in [
            CompletionSound::Classic,
            CompletionSound::Chime,
            CompletionSound::Bell,
            CompletionSound::Beep,
            CompletionSound::Soft,
        ] {
            let t = timbre_for(sound);
            let n = [Note {
                onset_ms: 0.0,
                freq: A5,
                dur_ms: 200.0,
                amp: 1.0,
                timbre: t,
            }];
            let s = samples(&n, 0.5);
            assert!(s.iter().all(|v| v.is_finite() && v.abs() <= 0.5 + 1e-6));
            assert!(s.iter().any(|v| v.abs() > 0.1), "{sound:?} silent");
        }
    }
}
