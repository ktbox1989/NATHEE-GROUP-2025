"use client";

import type { IScannerControls } from "@zxing/browser";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type ScannerState = "idle" | "starting" | "scanning" | "error";

export function QrScanner() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const handledRef = useRef(false);
  const [state, setState] = useState<ScannerState>("idle");
  const [message, setMessage] = useState("กดเริ่มสแกนเมื่อพร้อม ระบบจะขอสิทธิ์ใช้กล้อง");

  useEffect(() => () => controlsRef.current?.stop(), []);

  function stopScanner() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    handledRef.current = false;
    setState("idle");
    setMessage("หยุดกล้องแล้ว สามารถเริ่มสแกนใหม่ได้");
  }

  async function startScanner() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    handledRef.current = false;

    if (!navigator.mediaDevices?.getUserMedia) {
      setState("error");
      setMessage("เบราว์เซอร์นี้ไม่รองรับกล้อง กรุณากรอกรหัสใต้ QR แทน");
      return;
    }

    setState("starting");
    setMessage("กำลังเปิดกล้อง…");
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader();
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current ?? undefined,
        (result, error, activeControls) => {
          void error;
          if (!result || handledRef.current) return;
          handledRef.current = true;
          activeControls.stop();
          const value = result.getText();
          router.push(`/app/scan?code=${encodeURIComponent(value)}`);
        },
      );
      controlsRef.current = controls;
      setState("scanning");
      setMessage("เล็ง QR ให้อยู่กลางกรอบ ระบบจะเปิดข้อมูลให้อัตโนมัติ");
    } catch (error) {
      controlsRef.current?.stop();
      controlsRef.current = null;
      const errorName = error instanceof DOMException ? error.name : "";
      setState("error");
      setMessage(
        errorName === "NotAllowedError"
          ? "ไม่ได้รับสิทธิ์ใช้กล้อง กรุณาอนุญาตกล้องในเบราว์เซอร์หรือกรอกรหัสแทน"
          : "เปิดกล้องไม่สำเร็จ กรุณาตรวจสิทธิ์กล้องหรือกรอกรหัสใต้ QR แทน",
      );
    }
  }

  const cameraActive = state === "starting" || state === "scanning";

  return (
    <section className="app-panel qr-camera-card" aria-labelledby="camera-title">
      <div className="qr-camera-head">
        <div>
          <p>CAMERA SCANNER</p>
          <h2 id="camera-title">สแกนด้วยกล้อง</h2>
        </div>
        <span className={`scanner-state ${state}`}>{scannerStateLabel(state)}</span>
      </div>
      <div className={`qr-video-frame ${cameraActive ? "active" : ""}`}>
        <video ref={videoRef} muted playsInline aria-label="ภาพจากกล้องสำหรับสแกน QR" />
        {!cameraActive && <div className="qr-video-placeholder" aria-hidden="true">⌗</div>}
      </div>
      <p className={state === "error" ? "scanner-message error" : "scanner-message"} role="status" aria-live="polite">{message}</p>
      <div className="qr-camera-actions">
        {!cameraActive ? (
          <button className="button button-gradient" type="button" onClick={startScanner}>เริ่มสแกน QR</button>
        ) : (
          <button className="button button-glass" type="button" onClick={stopScanner}>หยุดกล้อง</button>
        )}
      </div>
    </section>
  );
}

function scannerStateLabel(state: ScannerState): string {
  if (state === "starting") return "กำลังเริ่ม";
  if (state === "scanning") return "พร้อมสแกน";
  if (state === "error") return "ใช้กล้องไม่ได้";
  return "ยังไม่เปิดกล้อง";
}
