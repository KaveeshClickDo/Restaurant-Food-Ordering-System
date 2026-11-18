"use client";

/**
 * Scan a booking's check-in QR with the device camera (tablet, phone or
 * webcam). Uses the qr-scanner package, which reads with the browser's own
 * barcode detector where there is one and its own decoder elsewhere (e.g.
 * Chrome on Windows). The camera runs only while this window is open.
 */

import { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import type QrScanner from "qr-scanner";

function cameraErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  const text = String(err ?? "");
  if (name === "NotAllowedError" || /permission|denied|not allowed/i.test(text)) {
    return "Camera permission was refused. Allow the camera for this site (on the tablet app: in the app's Android settings), or use a plug-in scanner or type the reference.";
  }
  if (name === "NotFoundError" || /no camera|not found/i.test(text)) {
    return "No camera was found on this device. Use a plug-in scanner or type the reference.";
  }
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "The camera only works on a secure (https) connection. Use a plug-in scanner or type the reference.";
  }
  return "The camera couldn't be started. Use a plug-in scanner or type the reference.";
}

export default function CameraScanModal({
  onResult,
  onClose,
}: {
  onResult: (text: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let scanner: QrScanner | null = null;
    let cancelled = false;
    let handled = false;

    (async () => {
      try {
        const { default: Scanner } = await import("qr-scanner");
        if (cancelled || !videoRef.current) return;
        scanner = new Scanner(
          videoRef.current,
          (result) => {
            if (handled) return;
            handled = true;
            scanner?.stop();
            onResultRef.current(result.data);
          },
          {
            preferredCamera: "environment",
            highlightScanRegion: true,
            highlightCodeOutline: true,
            returnDetailedScanResult: true,
            maxScansPerSecond: 10,
          },
        );
        await scanner.start();
        if (cancelled) { scanner.destroy(); scanner = null; return; }
        setStarting(false);
      } catch (err) {
        if (!cancelled) {
          setStarting(false);
          setError(cameraErrorMessage(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      scanner?.destroy();
      scanner = null;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label="Scan booking QR code">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Camera size={18} className="text-gray-500" />
            <p className="font-semibold text-gray-900 text-sm">Scan the guest&apos;s QR code</p>
          </div>
          <button onClick={onClose} aria-label="Close camera" className="text-gray-400 hover:text-gray-700 transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="relative w-full aspect-square bg-gray-900 rounded-xl overflow-hidden">
            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
            {starting && !error && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-sm">Starting camera…</div>
            )}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>
          ) : (
            <p className="text-xs text-gray-500 text-center">Hold the QR code inside the frame. It reads by itself.</p>
          )}
          <button onClick={onClose} className="w-full py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
