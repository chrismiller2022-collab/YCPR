export default function ConfLink({ conf, onNavigateConference }: any) {
  if (!onNavigateConference) return <>{conf}</>;
  return (
    <button className="conf-link" onClick={() => onNavigateConference(conf)}>
      {conf}
    </button>
  );
}
