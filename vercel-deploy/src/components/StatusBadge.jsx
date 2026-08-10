import { STATUS_CLASS, STATUS_LABELS } from "../lib/contract";

export default function StatusBadge({ status }) {
  const label = STATUS_LABELS[status] || "Unknown";
  const cls = STATUS_CLASS[status] || "ended";
  return <span className={`badge badge-${cls}`}>{label}</span>;
}
