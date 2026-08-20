/* eslint-disable @next/next/no-img-element -- QR artwork comes from an authenticated same-origin SVG endpoint. */
import type { OperationalQrEntityType } from "@/lib/qr";

const endpointNames: Record<OperationalQrEntityType, string> = {
  motorcycle: "motorcycles",
  job: "jobs",
  yard: "yards",
  truck: "trucks",
  trip: "trips",
};

export function OperationalQrLabel({ entityType, publicId, title, subtitle, details }: {
  entityType: OperationalQrEntityType;
  publicId: string;
  title: string;
  subtitle: string;
  details: ReadonlyArray<{ label: string; value: string }>;
}) {
  return (
    <article className="vehicle-label operational-label">
      <div className="vehicle-label-brand"><b>NATHEE GROUP 2025</b><span>SECURE {entityType.toUpperCase()} LABEL</span></div>
      <img src={`/api/qr/${endpointNames[entityType]}/${encodeURIComponent(publicId)}`} alt={`QR อ้างอิง ${title}`} width={232} height={232} decoding="sync" />
      <div className="vehicle-label-copy">
        <h2>{title}</h2>
        <p>{subtitle}</p>
        <dl>{details.map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value || "—"}</dd></div>)}</dl>
        <small>{publicId}</small>
      </div>
    </article>
  );
}
