import QRCode from "qrcode";
import { createMotorcycleQrToken } from "./qr.ts";

export async function renderMotorcycleQrSvg(publicId: string): Promise<string> {
  const token = createMotorcycleQrToken(publicId);
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
