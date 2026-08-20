import QRCode from "qrcode";
import { createMotorcycleQrToken, createOperationalQrToken, type OperationalQrEntityType } from "./qr.ts";

export async function renderOperationalQrSvg(entityType: OperationalQrEntityType, publicId: string): Promise<string> {
  return renderToken(createOperationalQrToken(entityType, publicId));
}

export async function renderMotorcycleQrSvg(publicId: string): Promise<string> {
  return renderToken(createMotorcycleQrToken(publicId));
}

async function renderToken(token: string): Promise<string> {
  return QRCode.toString(token, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 320,
    color: {
      dark: "#0b1022",
      light: "#ffffff",
    },
  });
}
