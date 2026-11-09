//! Read only this application's playback stream; samples never leave memory.
#[cfg(any(target_os = "linux", test))]
struct Spectrum {
    peak: f32,
}
#[cfg(any(target_os = "linux", test))]
impl Spectrum {
    fn new() -> Self {
        Self { peak: 0.001 }
    }
    fn analyse(&mut self, samples: &[f32]) -> Vec<f32> {
        let n = samples.len() as f32;
        let rms = (samples.iter().map(|x| x * x).sum::<f32>() / n).sqrt();
        if rms < 0.000001 {
            return vec![0.0; 93];
        }
        self.peak = (self.peak * 0.995).max(rms);
        let energy = (rms / self.peak).clamp(0.0, 1.0);
        let mut bands = vec![0.0_f32; 24];
        for (i, band) in bands.iter_mut().enumerate() {
            let frequency = 45.0_f32 * (7000.0_f32 / 45.0).powf(i as f32 / 23.0);
            let coefficient = 2.0 * (std::f32::consts::TAU * frequency / 16000.0).cos();
            let (mut a, mut b) = (0.0, 0.0);
            for (j, sample) in samples.iter().enumerate() {
                let window = 0.5 - 0.5 * (std::f32::consts::TAU * j as f32 / n).cos();
                let next = sample * window + coefficient * a - b;
                b = a;
                a = next;
            }
            let magnitude = (a * a + b * b - coefficient * a * b).max(0.0).sqrt() / n * 4.0;
            *band = (magnitude / self.peak * 1.8).clamp(0.0, 1.0);
        }
        let average = |start, end| bands[start..end].iter().sum::<f32>() / (end - start) as f32;
        let mut result = vec![rms, energy, average(0, 7), average(7, 16), average(16, 24)];
        result.extend(bands);
        for chunk in samples.chunks(samples.len() / 64) {
            let peak = chunk
                .iter()
                .copied()
                .max_by(|a, b| a.abs().total_cmp(&b.abs()))
                .unwrap_or(0.0);
            result.push((peak / self.peak * 0.45).clamp(-1.0, 1.0));
        }
        result
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use super::Spectrum;
    use serde_json::Value;
    use std::{
        io::Read,
        process::{Child, Command, Stdio},
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Mutex,
        },
        thread::{self, JoinHandle},
        time::{Duration, Instant},
    };

    type SharedLevels = Arc<Mutex<Option<(Instant, Vec<f32>)>>>;

    #[derive(Default)]
    pub struct RadioMeter(Mutex<Option<Capture>>);
    struct Capture {
        cancelled: Arc<AtomicBool>,
        child: Arc<Mutex<Option<Child>>>,
        values: SharedLevels,
        thread: Option<JoinHandle<()>>,
    }
    // The process API accepts only fixed commands and fixed list operations.
    fn query(kind: &str) -> Option<Value> {
        let mut child = Command::new("pactl")
            .args(["-f", "json", "list", kind])
            .env("LC_ALL", "C")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let stdout = child.stdout.take()?;
        let reader = thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = stdout.take(131073).read_to_end(&mut bytes);
            bytes
        });
        let deadline = Instant::now() + Duration::from_millis(900);
        let success = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status.success(),
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break false;
                }
            }
        };
        let bytes = reader.join().ok()?;
        if !success || bytes.len() > 131072 {
            return None;
        }
        serde_json::from_slice(&bytes).ok()
    }
    fn owned(mut pid: u32) -> bool {
        let root = std::process::id();
        for _ in 0..24 {
            if pid == root {
                return true;
            }
            if pid <= 1 {
                return false;
            }
            let Ok(status) = std::fs::read_to_string(format!("/proc/{pid}/status")) else {
                return false;
            };
            let Some(parent) = status.lines().find_map(|line| {
                line.strip_prefix("PPid:")
                    .and_then(|value| value.trim().parse::<u32>().ok())
            }) else {
                return false;
            };
            pid = parent;
        }
        false
    }
    fn target() -> Option<(u32, String)> {
        let inputs = query("sink-inputs")?;
        let (index, sink) = select_output(&inputs, owned)?;
        let sinks = query("sinks")?;
        let monitor = select_monitor(&sinks, sink)?;
        Some((index, monitor))
    }
    pub(super) fn select_output(
        inputs: &Value,
        mut owns: impl FnMut(u32) -> bool,
    ) -> Option<(u32, u32)> {
        let mut found = None;
        for input in inputs.as_array()? {
            let Some(pid) = input
                .get("properties")
                .and_then(|p| p.get("application.process.id"))
                .and_then(Value::as_str)
                .and_then(|s| s.parse::<u32>().ok())
            else {
                continue;
            };
            if !owns(pid) {
                continue;
            }
            let index = u32::try_from(input.get("index")?.as_u64()?).ok()?;
            let sink = u32::try_from(input.get("sink")?.as_u64()?).ok()?;
            if found.is_some() {
                return None;
            }
            found = Some((index, sink));
        }
        found
    }
    pub(super) fn select_monitor(sinks: &Value, index: u32) -> Option<String> {
        let monitor = sinks
            .as_array()?
            .iter()
            .find(|s| s.get("index").and_then(Value::as_u64) == Some(index as u64))?
            .get("monitor_source")?
            .as_str()?;
        if !monitor.ends_with(".monitor")
            || monitor.len() > 256
            || !monitor
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
        {
            return None;
        }
        Some(monitor.to_string())
    }
    fn kill(child: &Mutex<Option<Child>>) {
        if let Ok(mut guard) = child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
    impl Capture {
        fn start() -> Self {
            let cancelled = Arc::new(AtomicBool::new(false));
            let child = Arc::new(Mutex::new(None));
            let values = Arc::new(Mutex::new(None));
            let (cancelled_worker, child_worker, values_worker) =
                (cancelled.clone(), child.clone(), values.clone());
            let thread = thread::spawn(move || {
                let mut spectrum = Spectrum::new();
                while !cancelled_worker.load(Ordering::Acquire) {
                    let Some((index, monitor)) = target() else {
                        thread::sleep(Duration::from_millis(150));
                        continue;
                    };
                    let stdout = {
                        let Ok(mut guard) = child_worker.lock() else {
                            break;
                        };
                        if cancelled_worker.load(Ordering::Acquire) {
                            break;
                        }
                        let Ok(mut process) = Command::new("parec")
                            .args([
                                format!("--monitor-stream={index}"),
                                format!("--device={monitor}"),
                                "--raw".into(),
                                "--format=s16le".into(),
                                "--rate=16000".into(),
                                "--channels=1".into(),
                                "--latency-msec=40".into(),
                                "--client-name=HORIZON rhythm".into(),
                            ])
                            .stdin(Stdio::null())
                            .stdout(Stdio::piped())
                            .stderr(Stdio::null())
                            .spawn()
                        else {
                            break;
                        };
                        let stdout = process.stdout.take();
                        *guard = Some(process);
                        stdout
                    };
                    let Some(mut stdout) = stdout else {
                        kill(&child_worker);
                        break;
                    };
                    let mut bytes = [0u8; 1024];
                    while !cancelled_worker.load(Ordering::Acquire)
                        && stdout.read_exact(&mut bytes).is_ok()
                    {
                        let samples: Vec<f32> = bytes
                            .as_chunks::<2>()
                            .0
                            .iter()
                            .map(|p| i16::from_le_bytes([p[0], p[1]]) as f32 / 32768.0)
                            .collect();
                        let measured = spectrum.analyse(&samples);
                        if let Ok(mut latest) = values_worker.lock() {
                            *latest = Some((Instant::now(), measured));
                        }
                    }
                    kill(&child_worker);
                    if let Ok(mut latest) = values_worker.lock() {
                        *latest = None;
                    }
                }
            });
            Self {
                cancelled,
                child,
                values,
                thread: Some(thread),
            }
        }
        fn cancel(&self) {
            self.cancelled.store(true, Ordering::Release);
            kill(&self.child);
        }
    }
    impl Drop for Capture {
        fn drop(&mut self) {
            self.cancel();
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }
    impl RadioMeter {
        pub fn set(&self, enabled: bool) -> Result<(), String> {
            let mut guard = self
                .0
                .lock()
                .map_err(|_| "节奏分析暂不可用。".to_string())?;
            if enabled {
                if guard.is_none() {
                    *guard = Some(Capture::start());
                }
                return Ok(());
            }
            let previous = guard.take();
            drop(guard);
            drop(previous);
            Ok(())
        }
        pub fn read(&self) -> Vec<f32> {
            let Ok(guard) = self.0.lock() else {
                return vec![];
            };
            let Some(capture) = guard.as_ref() else {
                return vec![];
            };
            let Ok(values) = capture.values.lock() else {
                return vec![];
            };
            values
                .as_ref()
                .filter(|(at, _)| at.elapsed() < Duration::from_millis(500))
                .map(|(_, values)| values.clone())
                .unwrap_or_default()
        }
        pub fn cancel(&self) {
            if let Ok(guard) = self.0.lock() {
                if let Some(capture) = guard.as_ref() {
                    capture.cancel();
                }
            }
        }
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn selection_rejects_other_processes_missing_identity_and_ambiguity() {
            let values = serde_json::json!([{"index":8,"sink":2,"properties":{"application.process.id":"11"}},{"index":9,"sink":3,"properties":{"application.process.id":"22"}}]);
            assert_eq!(select_output(&values, |pid| pid == 22), Some((9, 3)));
            assert_eq!(select_output(&values, |_| false), None);
            assert_eq!(select_output(&values, |_| true), None);
            assert_eq!(
                select_output(
                    &serde_json::json!([{"index":9,"sink":3,"properties":{}}]),
                    |_| true
                ),
                None
            );
        }
        #[test]
        fn only_the_selected_sink_monitor_can_be_used() {
            assert_eq!(
                select_monitor(
                    &serde_json::json!([{"index":2,"monitor_source":"alsa.output.monitor"}]),
                    2
                ),
                Some("alsa.output.monitor".into())
            );
            assert_eq!(
                select_monitor(
                    &serde_json::json!([{"index":2,"monitor_source":"alsa.input"}]),
                    2
                ),
                None
            );
            assert_eq!(
                select_monitor(
                    &serde_json::json!([{"index":2,"monitor_source":"alsa.output.monitor"}]),
                    3
                ),
                None
            );
        }
    }
}
#[cfg(target_os = "linux")]
pub use linux::RadioMeter;
#[cfg(not(target_os = "linux"))]
#[derive(Default)]
pub struct RadioMeter {
    _private: (),
}
#[cfg(not(target_os = "linux"))]
impl RadioMeter {
    pub fn set(&self, enabled: bool) -> Result<(), String> {
        if enabled {
            Err("此平台暂不支持系统节奏分析。".into())
        } else {
            Ok(())
        }
    }
    pub fn read(&self) -> Vec<f32> {
        vec![]
    }
    pub fn cancel(&self) {}
}
#[cfg(test)]
mod tests {
    use super::*;
    fn tone(frequency: f32, amplitude: f32) -> Vec<f32> {
        (0..512)
            .map(|i| (std::f32::consts::TAU * frequency * i as f32 / 16000.0).sin() * amplitude)
            .collect()
    }
    #[test]
    fn silence_has_no_synthetic_pulse() {
        assert_eq!(Spectrum::new().analyse(&[0.0; 512]), vec![0.0; 93]);
    }
    #[test]
    fn spectrum_distinguishes_bass_and_treble() {
        let low = Spectrum::new().analyse(&tone(100.0, 0.1));
        let high = Spectrum::new().analyse(&tone(5000.0, 0.1));
        assert!(low[2] > low[4] * 5.0);
        assert!(high[4] > high[2] * 5.0);
    }
    #[test]
    fn quiet_music_is_measured_and_levels_stay_finite() {
        let levels = Spectrum::new().analyse(&tone(400.0, 0.0001));
        assert!(levels[0] > 0.000001);
        assert!(levels[..29]
            .iter()
            .all(|n| n.is_finite() && *n >= 0.0 && *n <= 1.0));
        assert!(levels[29..].iter().all(|n| n.is_finite() && n.abs() <= 1.0));
    }
}

#[cfg(test)]
mod waveform_tests {
    use super::*;
    #[test]
    fn waveform_keeps_the_sign_and_time_order_of_real_samples() {
        let mut samples = vec![0.1; 512];
        samples[256..].fill(-0.1);
        let values = Spectrum::new().analyse(&samples);
        assert_eq!(values.len(), 93);
        assert!(values[29..61].iter().all(|n| *n > 0.4));
        assert!(values[61..].iter().all(|n| *n < -0.4));
    }
}
