import React, { useEffect, useRef, useState } from "react";

// --- helpers ---
const A4 = 440;
const A4_MIDI = 69;
const NOTE_NAMES = [
  "C",
  "C♯",
  "D",
  "D♯",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "A♯",
  "B",
];
const GUITAR_STD = [
  { name: "E2", midi: 40, freq: 82.4069 },
  { name: "A2", midi: 45, freq: 110.0 },
  { name: "D3", midi: 50, freq: 146.832 },
  { name: "G3", midi: 55, freq: 195.998 },
  { name: "B3", midi: 59, freq: 246.942 },
  { name: "E4", midi: 64, freq: 329.628 },
];

function freqToMidi(freq: number) {
  return Math.round(12 * Math.log2(freq / A4) + A4_MIDI);
}
function midiToFreq(midi: number) {
  return A4 * Math.pow(2, (midi - A4_MIDI) / 12);
}
function midiToName(midi: number) {
  const name = NOTE_NAMES[(midi + 1200) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}
function centsOff(freq: number, midi: number) {
  const ideal = midiToFreq(midi);
  return Math.round(1200 * Math.log2(freq / ideal));
}

// --- simple autocorrelation pitch detector ---
function detectPitchAutoCorrelation(buf: Float32Array, sampleRate: number) {
  // windowing (hann)
  for (let i = 0; i < buf.length; i++) {
    buf[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (buf.length - 1)));
  }
  const size = buf.length;
  const rms = Math.sqrt(buf.reduce((s, x) => s + x * x, 0) / size);
  if (rms < 0.008) return null; // too quiet / silence

  // normalized autocorrelation
  const ac = new Float32Array(size);
  for (let lag = 0; lag < size; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < size; i++) sum += buf[i] * buf[i + lag];
    ac[lag] = sum;
  }
  // find peak after the zero-lag
  let peakLag = -1;
  let peakVal = -Infinity;
  // limit search to ~70Hz..1000Hz range for instrument/voice
  const minLag = Math.floor(sampleRate / 1000);
  const maxLag = Math.floor(sampleRate / 70);
  for (let lag = minLag; lag < Math.min(maxLag, size); lag++) {
    if (ac[lag] > peakVal) {
      peakVal = ac[lag];
      peakLag = lag;
    }
  }
  if (peakLag <= 0) return null;

  // parabolic interpolation around the peak for sub-sample accuracy
  const y1 = ac[peakLag - 1] ?? 0;
  const y2 = ac[peakLag];
  const y3 = ac[peakLag + 1] ?? 0;
  const denom = y1 - 2 * y2 + y3;
  const shift = denom ? (0.5 * (y1 - y3)) / denom : 0;
  const trueLag = peakLag + shift;

  const freq = sampleRate / trueLag;
  if (!isFinite(freq) || freq < 50 || freq > 1500) return null;
  return freq;
}

// --- UI styles (inline to keep it single-file) ---
const card: React.CSSProperties = {
  background: "#0e1320",
  color: "#dfe7ff",
  border: "1px solid #213055",
  borderRadius: 16,
  padding: 24,
  width: "100%",
  maxWidth: "none",
  boxShadow: "0 10px 30px rgba(0,0,0,.35)",
};
const row: React.CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  flexWrap: "wrap",
  width: "100%",
};
const button: React.CSSProperties = {
  background: "#1f6feb",
  border: 0,
  color: "#fff",
  padding: "10px 14px",
  borderRadius: 10,
  cursor: "pointer",
  fontWeight: 700,
};
const ghost: React.CSSProperties = {
  ...button,
  background: "transparent",
  border: "1px solid #2b3b63",
  color: "#c7d2fe",
};
const meterWrap: React.CSSProperties = {
  background: "#0b1020",
  border: "1px solid #2b3b63",
  borderRadius: 12,
  padding: 12,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  width: "100%",
  boxSizing: "border-box",
};

// Navigation styles
const navBar: React.CSSProperties = {
  display: "flex",
  background: "#1a2332",
  borderRadius: 12,
  padding: 4,
  marginBottom: 20,
  gap: 4,
};

const navButton: React.CSSProperties = {
  flex: 1,
  padding: "12px 16px",
  border: "none",
  borderRadius: 8,
  background: "transparent",
  color: "#9ca3af",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600,
  transition: "all 0.2s ease",
};

const navButtonActive: React.CSSProperties = {
  ...navButton,
  background: "#1f6feb",
  color: "#fff",
};

// key layout for piano (C2–C6 to keep it compact)
const LOW_MIDI = 36; // C2
const HIGH_MIDI = 84; // C6
const WHITE_INDEX = new Set([0, 2, 4, 5, 7, 9, 11]); // note%12 that are white

function Piano({ activeMidi }: { activeMidi?: number }) {
  // build key list
  const keys = [];
  for (let m = LOW_MIDI; m <= HIGH_MIDI; m++) {
    const isWhite = WHITE_INDEX.has(m % 12);
    keys.push({ midi: m, isWhite });
  }
  const whiteKeys = keys.filter((k) => k.isWhite);
  const blackKeys = keys.filter((k) => !k.isWhite);

  return (
    <div
      style={{
        position: "relative",
        height: 120,
        userSelect: "none",
        width: "100%",
      }}
    >
      {/* white keys */}
      <div style={{ display: "flex", height: 120, width: "100%" }}>
        {whiteKeys.map((k) => {
          const on = activeMidi === k.midi;
          return (
            <div
              key={k.midi}
              style={{
                flex: "1 1 0",
                border: "1px solid #33406a",
                background: on ? "#a7f3d0" : "#f8fafc",
                color: "#111",
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  bottom: 4,
                  left: 6,
                  fontSize: 10,
                  opacity: 0.6,
                }}
              >
                {midiToName(k.midi)}
              </div>
            </div>
          );
        })}
      </div>
      {/* black keys overlay */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: 72,
          display: "flex",
          pointerEvents: "none",
        }}
      >
        {/* we need to place black keys over gaps: pattern per octave */}
        {whiteKeys.map((wk) => {
          // create an empty slot per white key; we'll overlay a black if its semitone belongs between this and next white
          const thisSemitone = wk.midi % 12;
          // black exists between certain white pairs
          const candidate =
            (thisSemitone === 0 && 1) ||
            (thisSemitone === 2 && 3) ||
            (thisSemitone === 5 && 6) ||
            (thisSemitone === 7 && 8) ||
            (thisSemitone === 9 && 10) ||
            -1;
          const blackMidi = candidate !== -1 ? wk.midi + 1 : null;

          return (
            <div
              key={`slot-${wk.midi}`}
              style={{ flex: "1 1 0", position: "relative" }}
            >
              {blackMidi && blackKeys.some((b) => b.midi === blackMidi) && (
                <div
                  style={{
                    position: "absolute",
                    left: "62%",
                    transform: "translateX(-50%)",
                    width: "60%",
                    height: "100%",
                    background:
                      activeMidi === blackMidi ? "#34d399" : "#111827",
                    border: "1px solid #1f2937",
                    borderRadius: "0 0 6px 6px",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Page Components
function PianoPage({ midi }: { midi?: number }) {
  return (
    <div>
      <h3 style={{ margin: "0 0 16px 0", fontSize: 18, opacity: 0.9 }}>
        🎹 Piano Visualizer
      </h3>
      <Piano activeMidi={midi} />
      <div
        style={{
          marginTop: 16,
          opacity: 0.7,
          fontSize: 12,
          textAlign: "center",
        }}
      >
        Play or sing a note to see it highlighted on the piano
      </div>
    </div>
  );
}

function TunerPage({
  running,
  start,
  stop,
  freq,
  note,
  offset,
  nearestString,
}: {
  running: boolean;
  start: () => void;
  stop: () => void;
  freq: number | null;
  note: string;
  offset: number;
  nearestString: string;
}) {
  const needle = Math.max(-50, Math.min(50, offset || 0));

  return (
    <div>
      <h3 style={{ margin: "0 0 16px 0", fontSize: 18, opacity: 0.9 }}>
        🎯 Precision Tuner
      </h3>

      <div style={{ ...row, marginBottom: 16 }}>
        <button
          style={running ? ghost : button}
          onClick={running ? stop : start}
        >
          {running ? "Stop" : "Start Mic"}
        </button>
        <div
          style={{
            marginLeft: "auto",
            fontSize: 12,
            opacity: 0.75,
            textAlign: "right",
            flex: "1 1 auto",
          }}
        >
          Tip: play a single note for best accuracy
        </div>
      </div>

      {/* Detection readout */}
      <div style={{ ...meterWrap, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, opacity: 0.75 }}>Detected Note</div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>
            {note || "—"} {freq ? `(${freq.toFixed(1)} Hz)` : ""}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 14, opacity: 0.75 }}>Cents Off</div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: offset
                ? Math.abs(offset) < 5
                  ? "#34d399"
                  : "#fcd34d"
                : "#9ca3af",
            }}
          >
            {offset > 0 ? `+${offset}` : offset}
          </div>
        </div>
      </div>

      {/* Tuner needle - enhanced for dedicated page */}
      <div
        style={{
          position: "relative",
          height: 100,
          background: "#0b1020",
          border: "1px solid #2b3b63",
          borderRadius: 12,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            bottom: 0,
            width: 2,
            background: "#3b82f6",
            opacity: 0.6,
            transform: "translateX(-50%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `calc(50% + ${needle * 1.8}px)`,
            top: 12,
            width: 4,
            bottom: 12,
            background: Math.abs(needle) < 5 ? "#34d399" : "#f59e0b",
            boxShadow: `0 0 20px ${
              Math.abs(needle) < 5
                ? "rgba(52,211,153,.8)"
                : "rgba(245,158,11,.6)"
            }`,
            transform: "translateX(-50%)",
            borderRadius: 2,
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: 16,
            fontSize: 12,
            opacity: 0.7,
          }}
        >
          −50¢
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 8,
            right: 16,
            fontSize: 12,
            opacity: 0.7,
          }}
        >
          +50¢
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: 12,
            opacity: 0.9,
            fontWeight: 600,
            color: Math.abs(needle) < 5 ? "#34d399" : "#9ca3af",
          }}
        >
          {Math.abs(offset) < 5 ? "IN TUNE" : "0¢"}
        </div>
      </div>

      {/* Guitar string reference */}
      <div style={{ ...meterWrap }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Nearest Guitar String</div>
        <div style={{ fontWeight: 800 }}>{nearestString}</div>
      </div>
    </div>
  );
}

function AboutPage() {
  return (
    <div>
      <h3 style={{ margin: "0 0 16px 0", fontSize: 18, opacity: 0.9 }}>
        ℹ️ About
      </h3>
      <div style={{ lineHeight: 1.6, opacity: 0.8 }}>
        <p style={{ marginBottom: 16 }}>
          <strong>Sound → Piano + Tuner</strong> is a real-time audio analysis
          tool that detects musical notes and displays them on a virtual piano.
        </p>
        <p style={{ marginBottom: 16 }}>
          <strong>Features:</strong>
        </p>
        <ul style={{ marginBottom: 16, paddingLeft: 20 }}>
          <li>Real-time pitch detection using autocorrelation</li>
          <li>Visual piano keyboard with note highlighting</li>
          <li>Precision tuner with cent accuracy</li>
          <li>Guitar string reference guide</li>
          <li>100% local processing - no data uploaded</li>
        </ul>
        <p style={{ marginBottom: 16 }}>
          <strong>How to use:</strong> Allow microphone access, then play or
          sing single notes. The app works best in quiet environments with
          clear, sustained tones.
        </p>
        <div
          style={{
            background: "#0b1020",
            padding: 12,
            borderRadius: 8,
            border: "1px solid #2b3b63",
            fontSize: 12,
            opacity: 0.7,
          }}
        >
          All audio processing happens locally in your browser using Web Audio
          API. No audio data is transmitted or stored.
        </div>
      </div>
    </div>
  );
}

export default function SoundPianoTuner() {
  const [currentPage, setCurrentPage] = useState<"piano" | "tuner" | "about">(
    "piano"
  );
  const [running, setRunning] = useState(false);
  const [freq, setFreq] = useState<number | null>(null);
  const [midi, setMidi] = useState<number | null>(null);
  const [note, setNote] = useState<string>("");
  const [offset, setOffset] = useState<number>(0); // cents
  const [nearestString, setNearestString] = useState<string>("—");

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const bufferRef = useRef<Float32Array | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const start = async () => {
    if (running) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      // Check for AudioContext support
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) {
        alert("Your browser does not support Web Audio API");
        return;
      }

      const ctx = new AudioContextClass();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096; // bigger = finer resolution, little more CPU
      analyser.smoothingTimeConstant = 0.0;
      src.connect(analyser);
      analyserRef.current = analyser;

      bufferRef.current = new Float32Array(analyser.fftSize);
      setRunning(true);
      loop();
    } catch (error) {
      console.error("Error starting audio:", error);
      alert("Failed to access microphone. Please check permissions.");
    }
  };

  const stop = () => {
    setRunning(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}
    streamRef.current = null;
    try {
      audioCtxRef.current?.close();
    } catch {}
    audioCtxRef.current = null;
    analyserRef.current = null;
    bufferRef.current = null;
    setFreq(null);
    setMidi(null);
    setNote("");
    setOffset(0);
    setNearestString("—");
  };

  const loop = () => {
    const analyser = analyserRef.current;
    const buf = bufferRef.current;
    const ctx = audioCtxRef.current;
    if (!analyser || !buf || !ctx) return;

    analyser.getFloatTimeDomainData(buf);
    const f = detectPitchAutoCorrelation(buf, ctx.sampleRate);
    if (f) {
      const m = freqToMidi(f);
      setFreq(f);
      setMidi(m);
      setNote(midiToName(m));
      setOffset(centsOff(f, m));
      // nearest guitar string (optional indicator)
      let best = GUITAR_STD[0];
      let bestDiff = Math.abs(f - best.freq);
      for (const s of GUITAR_STD) {
        const d = Math.abs(f - s.freq);
        if (d < bestDiff) {
          best = s;
          bestDiff = d;
        }
      }
      setNearestString(best.name);
    } else {
      setFreq(null);
      setMidi(null);
      setNote("");
      setOffset(0);
      setNearestString("—");
    }

    rafRef.current = requestAnimationFrame(loop);
  };

  useEffect(() => () => stop(), []); // cleanup on unmount

  const renderCurrentPage = () => {
    switch (currentPage) {
      case "piano":
        return <PianoPage midi={midi ?? undefined} />;
      case "tuner":
        return (
          <TunerPage
            running={running}
            start={start}
            stop={stop}
            freq={freq}
            note={note}
            offset={offset}
            nearestString={nearestString}
          />
        );
      case "about":
        return <AboutPage />;
      default:
        return <PianoPage midi={midi ?? undefined} />;
    }
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        width: "100vw",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0b0f17",
        padding: "16px",
        boxSizing: "border-box",
      }}
    >
      <div style={card}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20 }}>Sound → Piano + Tuner</h2>
          <div style={{ opacity: 0.7, fontSize: 12 }}>
            {running ? "🎤 Listening…" : "⏸️ Idle"}
          </div>
        </div>

        {/* Navigation */}
        <div style={navBar}>
          <button
            style={currentPage === "piano" ? navButtonActive : navButton}
            onClick={() => setCurrentPage("piano")}
          >
            Piano
          </button>
          <button
            style={currentPage === "tuner" ? navButtonActive : navButton}
            onClick={() => setCurrentPage("tuner")}
          >
            Tuner
          </button>
          <button
            style={currentPage === "about" ? navButtonActive : navButton}
            onClick={() => setCurrentPage("about")}
          >
            About
          </button>
        </div>

        {/* Page Content */}
        {renderCurrentPage()}

        {/* Footer */}
        <div
          style={{
            marginTop: 20,
            opacity: 0.6,
            fontSize: 11,
            textAlign: "center",
          }}
        >
          All processing is local (Web Audio). No audio is uploaded.
        </div>
      </div>
    </div>
  );
}
