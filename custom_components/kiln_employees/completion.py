"""Kiln completion notifications driven by an explicit Node-RED event token."""

import logging
from datetime import datetime

from homeassistant.core import EVENT_STATE_CHANGED, HomeAssistant, callback
from homeassistant.util import dt as dt_util

from .binary_sensor import employee_eligible
from .const import COMPLETION_ENTITY
from .notifications import send_mobile

_LOGGER = logging.getLogger(__name__)

INVALID_STATES = {"", "unknown", "unavailable", "none", "null"}
MAX_PROCESSED_IDS = 100


def _valid_completion_id(value: str | None) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if value.casefold() not in INVALID_STATES else None


def _is_assigned(employee: dict) -> bool:
    return "3" in {str(kiln) for kiln in employee.get("kilns", [])}


async def async_setup_completion(
    hass: HomeAssistant, entry, manager: dict
) -> None:
    """Listen for Node-RED's explicit, changing completion event token."""
    data = manager["data"]
    state = manager["completion_monitor"] = {
        "processed_ids": list(data.get("kiln_3_processed_completion_events", [])),
        "busy": False,
    }
    state["processed_ids"] = [
        item for item in state["processed_ids"] if isinstance(item, str)
    ][-MAX_PROCESSED_IDS:]

    async def persist_processed_ids() -> None:
        data["kiln_3_processed_completion_events"] = state["processed_ids"]
        await manager["store"].async_save(data)

    async def emit(completion_id: str, completed_at: datetime | None) -> None:
        title = "Kiln #3 Stopped"
        message = (
            "Kiln #3 has stopped. Check whether the drying schedule completed "
            "or the kiln was manually stopped."
        )
        attempted = []
        local_now = dt_util.as_local(dt_util.utcnow())
        for employee in list(data.get("employees", [])):
            if not employee.get("use_mobile_app") or not _is_assigned(employee):
                continue
            if not employee_eligible(manager, employee, local_now):
                continue
            try:
                await send_mobile(hass, employee, title, message)
                result = "submitted"
            except Exception as exc:  # noqa: BLE001
                _LOGGER.warning(
                    "Kiln completion delivery failed for employee ID %s: %s",
                    employee.get("id"),
                    exc,
                )
                result = "failed"
            attempted.append({"employee_id": employee.get("id"), "result": result})

        history = data.setdefault("notification_history", [])
        history.append({
            "timestamp": dt_util.utcnow().isoformat(),
            "kind": "kiln_completion",
            "source": "kiln_3",
            "completion_id": completion_id,
            "completed_at": completed_at.isoformat() if completed_at else None,
            "deliveries": attempted,
        })
        del history[:-100]
        try:
            await manager["store"].async_save(data)
        except Exception:
            _LOGGER.exception("Could not save kiln completion notification history")

    async def process(completion_id: str, completed_at: datetime | None) -> None:
        if state["busy"] or completion_id in state["processed_ids"]:
            return
        state["busy"] = True
        try:
            # Persist the deduplication marker before delivery. A restart after
            # a successful marker save cannot send the same charge twice.
            state["processed_ids"].append(completion_id)
            del state["processed_ids"][:-MAX_PROCESSED_IDS]
            await persist_processed_ids()
            await emit(completion_id, completed_at)
        finally:
            state["busy"] = False

    @callback
    def on_completion_event(event) -> None:
        entity = manager["data"].get("entities", {}).get(
            "kiln_3_completion", COMPLETION_ENTITY
        )
        if event.data.get("entity_id") != entity:
            return
        old_state = event.data.get("old_state")
        new_state = event.data.get("new_state")
        if new_state is None or old_state and old_state.state == new_state.state:
            return
        completion_id = _valid_completion_id(new_state.state)
        if completion_id is None:
            return
        completed_at = new_state.last_changed
        hass.async_create_task(process(completion_id, completed_at))

    completion_entity = manager["data"].get("entities", {}).get(
        "kiln_3_completion", COMPLETION_ENTITY
    )
    current = hass.states.get(completion_entity)
    current_id = _valid_completion_id(current.state if current else None)
    if current_id and current_id not in state["processed_ids"]:
        if state["processed_ids"]:
            # A new persisted ID may represent a completion while HA was down.
            await process(current_id, current.last_changed)
        else:
            # First startup establishes a baseline and never announces an old
            # completion that occurred before this integration was installed.
            state["processed_ids"].append(current_id)
            await persist_processed_ids()

    entry.async_on_unload(
        hass.bus.async_listen(EVENT_STATE_CHANGED, on_completion_event)
    )
