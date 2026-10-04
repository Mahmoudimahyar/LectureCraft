// SC18 Response capture — spoken teach-back (UI14). Recording starts only on an explicit gesture,
// lecture audio is paused first, and the audio never leaves this device: there is no hosted speech
// service and no automatic recognition is installed, so the learner types/corrects the transcript
// while listening back. Only the confirmed transcript is submitted; the audio is then discarded.
import { useEffect, useRef, useState } from "react";
import { Mic, Pause, Square } from "lucide-react";
import { Button, Callout, Dialog, Field, formatMs } from "@/components/ui";

interface ResponseCaptureProps {
  open: boolean;
  onClose: () => void;
  onPauseLecture: () => void;
  onConfirm: (result: { text: string; transcriptionRevision: string }) => void;
  initialText?: string;
}

type Phase = "idle" | "requesting" | "recording" | "paused" | "stopped" | "denied" | "unsupported";

export function ResponseCapture({ open, onClose, onPauseLecture, onConfirm, initialText = "" }: ResponseCaptureProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [text, setText] = useState(initialText);
  const [revision, setRevision] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const accumulated = useRef(0);

  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

  const release = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    recorder.current = null;
  };
  const discard = () => {
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    release();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    chunks.current = [];
  };

  useEffect(() => {
    if (!open) return;
    setPhase(supported ? "idle" : "unsupported");
    setElapsed(0);
    setText(initialText);
    accumulated.current = 0;
    return discard; // closing the dialog always stops the microphone: no background capture
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(() => setElapsed(accumulated.current + Date.now() - startedAt.current), 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  const start = async () => {
    onPauseLecture();
    setPhase("requesting");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setPhase("denied");
      return;
    }
    chunks.current = [];
    const rec = new MediaRecorder(stream.current);
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
      setAudioUrl(URL.createObjectURL(blob));
      release();
      setPhase("stopped");
    };
    recorder.current = rec;
    rec.start();
    startedAt.current = Date.now();
    setPhase("recording");
  };

  const pauseOrResume = () => {
    const rec = recorder.current;
    if (!rec) return;
    if (rec.state === "recording") {
      rec.pause();
      accumulated.current += Date.now() - startedAt.current;
      setPhase("paused");
    } else if (rec.state === "paused") {
      rec.resume();
      startedAt.current = Date.now();
      setPhase("recording");
    }
  };

  const stop = () => {
    const rec = recorder.current;
    if (rec && rec.state !== "inactive") {
      if (rec.state === "recording") accumulated.current += Date.now() - startedAt.current;
      setElapsed(accumulated.current);
      rec.stop();
    }
  };

  const active = phase === "recording" || phase === "paused";
  const close = () => {
    if (active && !window.confirm("Recording is still running. Stop and discard it?")) return;
    discard();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()} title="Explain aloud" description="Speak your explanation, then check the words before anything is sent."
      footer={<>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={active || text.trim().length === 0}
          onClick={() => {
            const rev = `tr-${Date.now().toString(36)}-${revision + 1}`;
            setRevision((r) => r + 1);
            discard(); // audio is not retained after the transcript is confirmed
            onConfirm({ text: text.trim(), transcriptionRevision: rev });
          }}>
          Use this transcript
        </Button>
      </>}>
      <div className="flex flex-col gap-3">
        <Callout tone="accent" title="What happens to your voice">
          Audio is recorded <strong>only on this device</strong> and is never uploaded. No automatic transcription is installed and no online speech service is used, so you write or correct the transcript yourself.
          When you confirm, only the transcript text is sent and the audio is discarded.
        </Callout>
        {phase === "unsupported" && <Callout tone="caution" role="alert" title="Recording is not available in this browser">You can still type your explanation below; it is submitted the same way.</Callout>}
        {phase === "denied" && <Callout tone="caution" role="alert" title="Microphone access was not granted">Nothing was recorded. You can type your explanation below instead, or allow the microphone in the browser's site settings and try again.</Callout>}
        {supported && phase !== "unsupported" && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Recording controls">
            {(phase === "idle" || phase === "denied" || phase === "stopped") && <Button onClick={start}><Mic aria-hidden className="size-4" /> {phase === "stopped" ? "Record again" : "Record"}</Button>}
            {phase === "requesting" && <span role="status">Waiting for microphone permission…</span>}
            {active && (
              <>
                <Button onClick={pauseOrResume}><Pause aria-hidden className="size-4" /> {phase === "paused" ? "Resume" : "Pause"}</Button>
                <Button variant="primary" onClick={stop}><Square aria-hidden className="size-4" /> Stop</Button>
              </>
            )}
            <span role="status" aria-live="polite" className="font-medium tabular-nums" data-testid="recording-state">
              {phase === "recording" ? `● Recording ${formatMs(elapsed)}` : phase === "paused" ? `Paused at ${formatMs(elapsed)}` : phase === "stopped" ? `Recorded ${formatMs(elapsed)}` : "Not recording"}
            </span>
          </div>
        )}
        {audioUrl && <audio controls src={audioUrl} className="w-full" aria-label="Your recording (kept on this device only)" />}
        <Field label="Transcript of what you said" htmlFor="capture-transcript" hint="Type it while listening back, and fix terms and symbols. Mark anything you are unsure you said with [?] rather than guessing.">
          <textarea id="capture-transcript" className="ll-input min-h-[9rem]" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
