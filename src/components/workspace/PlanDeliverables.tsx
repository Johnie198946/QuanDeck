import type { IdeaPlan } from "../../data/types";
import type { DeliverySlotDraft } from "../../data/goalDelivery";
import { directionDeliverables } from "../../data/directionDeliverables";
import { useWorkdeck } from "../../state/WorkdeckContext";
import { Icon } from "../ui/Icon";

/** Expected deliveries describe the direction; actual content stays in the delivery map. */
export function PlanDeliverables({ plan }: { plan: IdeaPlan }) {
  const { snap } = useWorkdeck();
  const { current, proposed, scopeLabel } = directionDeliverables(snap, plan);
  const hasProposal = proposed !== undefined;
  return (
    <section
      id={`direction-${plan.id}-deliverables`}
      className="qd-direction-section qd-direction-deliverables"
      tabIndex={-1}
      aria-label="方向交付清单"
    >
      <header>
        <div>
          <span className="qd-direction-eyebrow">交付结构</span>
          <h3>最终会得到什么</h3>
        </div>
        <span className="qd-direction-version">
          {current.length ? "当前清单" : hasProposal ? "待确认" : "尚未定义"}
        </span>
      </header>
      <p>
        {scopeLabel} · {current.length} 项已登记
        {plan.scope !== "project" && "。子任务在各自方向页列明；成果地图展示汇总关系。"}
      </p>
      {current.length ? (
        <DeliveryList slots={current} />
      ) : (
        !hasProposal && (
          <p>尚未定义{scopeLabel}件。可以在对应成果地图定义交付件，也可以先讨论交付要求。</p>
        )
      )}
      {hasProposal && (
        <details open={!current.length}>
          <summary>待确认的交付建议 · {proposed.length} 项</summary>
          <p>讨论建议尚未改变当前清单。确认变更后再按新要求交付。</p>
          {proposed.length ? (
            <DeliveryList slots={proposed} />
          ) : (
            <p>本轮建议清空交付清单，当前已登记内容仍保留。</p>
          )}
        </details>
      )}
    </section>
  );
}

function DeliveryList({ slots }: { slots: DeliverySlotDraft[] }) {
  return (
    <ol>
      {slots.map((slot) => (
        <li
          key={slot.id}
          className={slots.some((parent) => parent.id === slot.parentId) ? "is-child" : ""}
        >
          <Icon name="box" size={16} />
          <div>
            <strong>{slot.title}</strong>
            {slot.description && <p>{slot.description}</p>}
            {slot.contract && (
              <p>
                {slot.contract.format.toUpperCase()} ·{" "}
                {slot.contract.required ? "必需交付" : "可选交付"}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
