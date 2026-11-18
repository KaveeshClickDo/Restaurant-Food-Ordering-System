"use client";

/**
 * A booking's check-in QR code, as the guest shows it on arrival (booking
 * confirmed screens, the guest's booking page, the booking receipt). Always on
 * a white square so scanners get full contrast, whatever the page theme.
 * Codes and rules: lib/reservationCheckIn.ts.
 */

import { useEffect, useState } from "react";
import { checkInQrText } from "@/lib/reservationCheckIn";

/** PNG data URL of a booking's check-in QR, drawn in the browser. */
export async function checkInQrDataUrl(code: string, width = 480): Promise<string> {
  const mod = await import("qrcode");
  const toDataURL = mod.toDataURL ?? mod.default?.toDataURL;
  return toDataURL(checkInQrText(code), { errorCorrectionLevel: "M", margin: 2, width });
}

export default function CheckInQr({
  code,
  reference,
  size = 168,
  caption = true,
  className = "",
}: {
  code: string;
  /** The 8-character booking reference, shown as the no-camera fallback. */
  reference: string;
  size?: number;
  caption?: boolean;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    setFailed(false);
    checkInQrDataUrl(code)
      .then((url) => { if (alive) setSrc(url); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [code]);

  return (
    <div className={`flex flex-col items-center text-center ${className}`}>
      {caption && (
        <p className="text-sm font-semibold text-gray-800 dark:text-zinc-100 mb-2">Your check-in code</p>
      )}
      {failed ? null : src ? (
        // eslint-disable-next-line @next/next/no-img-element -- generated data: URL
        <img
          src={src}
          width={size}
          height={size}
          alt={`Check-in QR code for booking ${reference}`}
          className="rounded-xl bg-white p-1.5 shadow-sm border border-gray-200"
          style={{ width: size, height: size }}
        />
      ) : (
        <div className="rounded-xl bg-white border border-gray-200 animate-pulse" style={{ width: size, height: size }} />
      )}
      {caption && (
        <p className="text-xs text-gray-500 dark:text-zinc-400 mt-2 leading-relaxed">
          Show this at the restaurant when you arrive.
          <br />
          No QR? Give your booking reference{" "}
          <span className="font-mono font-semibold text-gray-700 dark:text-zinc-200 tracking-wider">{reference}</span>
        </p>
      )}
    </div>
  );
}
