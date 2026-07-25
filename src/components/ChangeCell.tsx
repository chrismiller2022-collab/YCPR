import { spreadColor } from "../lib/odds";

export default function ChangeCell({ change }: any) {
  if (change == null) {
    return <td className="wintotals-total-cell change-cell">–</td>;
  }
  return (
    <td className="wintotals-total-cell change-cell" style={{ color: spreadColor(change) }}>
      {change > 0 ? "+" : ""}
      {change.toFixed(2)}
    </td>
  );
}
