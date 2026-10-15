"""Kiln completion notifications driven by configured kiln signals."""

import logging
from datetime import datetime

from homeassistant.core import EVENT_STATE_CHANGED, HomeAssistant, callback
from homeassistant.util import dt as dt_util

from .binary_sensor import employee_eligible
from .const import COMPLETION_ENTITY, COMPLETION_RULES
from .notifications import send_mobile

_LOGGER = logging.getLogger(__name__)

INVALID_STATES = {"", "unknown", "unavailable", "none", "null"}
STOPPED_STATE = "Stopped / Idle"
MAX_PROCESSED_IDS = 100


def _matches_completion_rule(manager: dict, kiln_id: str, rule: str) -> bool:
    """Check the configured completion condition against the latest PLC values."""
    values = manager.get("kiln_monitor", {}).get("values")
    if rule == "stopped_idle":
        return True
    if not isinstance(values, dict):
        return False
    if rule == "normal_stop_or_down":
        return values.get("Normal_Stop") is True or values.get("Kiln_Down") is True
    if rule == "normal_stop":
        return values.get("Normal_Stop") is True
    if rule == "kiln_down":
        return values.get("Kiln_Down") is True
    if rule == "final_step":
        return (isinstance(values.get("Step_Number"), int)
                and isinstance(values.get("Step_Stop"), int)
                and values["Step_Stop"] > 0
                and values["Step_Number"] >= values["Step_Stop"])
    return False


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
    """Listen for Node-RED's exact Stopped / Idle status transition."""
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
            "kiln_3_status", COMPLETION_ENTITY
        )
        if event.data.get("entity_id") != entity:
            return
        old_state = event.data.get("old_state")
        new_state = event.data.get("new_state")
        if new_state is None or old_state and old_state.state == new_state.state:
            return
        if new_state.state != STOPPED_STATE:
            return
        kiln_config = data.get("settings", {}).get("kiln_configs", {}).get("3", {})
        completion_rule = kiln_config.get("completion_rule", "stopped_idle")
        if completion_rule not in COMPLETION_RULES:
            completion_rule = "stopped_idle"
        if not _matches_completion_rule(manager, "3", completion_rule):
            _LOGGER.info("Kiln #3 stopped without meeting completion rule %s", completion_rule)
            return
        completion_id = new_state.last_changed.isoformat()
        completed_at = new_state.last_changed
        hass.async_create_task(process(completion_id, completed_at))

    completion_entity = manager["data"].get("entities", {}).get(
        "kiln_3_status", COMPLETION_ENTITY
    )
    current = hass.states.get(completion_entity)
    # Establish a baseline at startup; do not announce a kiln that was already
    # stopped before Home Assistant or the integration loaded.

    entry.async_on_unload(
        hass.bus.async_listen(EVENT_STATE_CHANGED, on_completion_event)
    )
