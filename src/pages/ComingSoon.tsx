import { Clock } from "lucide-react";

export default function ComingSoon({ categoryLabel, subLabel }: any) {
  return (
    <div className="cs-wrap">
      <div className="cs-card">
        <Clock size={26} strokeWidth={1.75} />
        <div className="cs-eyebrow">{categoryLabel}</div>
        <div className="cs-week">{subLabel}</div>
        <div className="cs-msg">Data coming soon</div>
        <p className="cs-note">
          This page is wired up and ready to go — numbers will appear here once this week's data is in.
        </p>
      </div>
    </div>
  );
}
