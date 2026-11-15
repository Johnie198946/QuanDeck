import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "./Icon";

export function Toasts() {
  const { toasts } = useWorkdeck();
  return (
    <div className="qd-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`qd-toast tone-${t.tone}`}>
          <Icon name={t.tone === "error" ? "alert" : "check"} size={16} />
          {t.message}
        </div>
      ))}
    </div>
  );
}
