"use client";
import { useEffect, useRef, useState } from "react";

/** Front-camera selfie for clock-in. Returns a compressed JPEG (max 640 px). Nothing is kept on the device. */
export function SelfieCapture({
  required,
  onDone,
  onCancel,
}: {
  required: boolean;
  onDone: (photo: Blob | null) => void;
  onCancel: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [shot, setShot] = useState<string | null>(null);
  const blob = useRef<Blob | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 } }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setError("Camera blocked. Allow camera access for this site, or ask HR to switch selfies off."));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  const take = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, 640 / v.videoWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(
      (b) => {
        blob.current = b;
        setShot(b ? URL.createObjectURL(b) : null);
      },
      "image/jpeg",
      0.8,
    );
  };

  return (
    <div
      className="fixed inset-0 z-[95] grid place-items-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Clock-in selfie"
    >
      <div className="card w-full max-w-sm p-5">
        <p className="eyebrow">Clock-in selfie</p>
        <p className="mt-1 text-sm text-muted">
          {required ? "Required by your company." : "Optional."} Only you, your manager and HR can see it.
        </p>
        <div className="mt-4 overflow-hidden rounded-xl bg-black">
          {shot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shot} alt="Your selfie" className="aspect-[3/4] w-full object-cover" />
          ) : (
            <video ref={video} autoPlay playsInline muted className="aspect-[3/4] w-full -scale-x-100 object-cover" />
          )}
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {shot ? (
            <>
              <button type="button" className="btn-primary flex-1" onClick={() => onDone(blob.current)}>
                Use photo & clock in
              </button>
              <button type="button" className="btn-ghost" onClick={() => setShot(null)}>
                Retake
              </button>
            </>
          ) : (
            <button type="button" className="btn-primary flex-1" onClick={take} disabled={!!error}>
              Take photo
            </button>
          )}
          {!required && (
            <button type="button" className="btn-ghost" onClick={() => onDone(null)}>
              Skip
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
