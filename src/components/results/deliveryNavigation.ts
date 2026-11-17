import type { DeliveryScope } from "../../data/deliveryPresentation";

// Ephemeral navigation only: no delivery, review or publication state is stored here.
const eventName = "quandeck:delivery-focus";
let pending: { projectId: string; scope: DeliveryScope; slotId: string } | undefined;
export function requestDeliveryFocus(projectId: string, scope: DeliveryScope, slotId: string) {
  pending = { projectId, scope, slotId };
  window.dispatchEvent(new Event(eventName));
}
export function takeDeliveryFocus(projectId: string, scope: DeliveryScope): string | undefined {
  if (
    pending?.projectId !== projectId ||
    pending.scope.taskId !== scope.taskId ||
    pending.scope.workItemId !== scope.workItemId
  )
    return;
  const slotId = pending.slotId;
  pending = undefined;
  return slotId;
}
export const deliveryFocusEvent = eventName;
