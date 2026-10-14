"""Kiln #3 paused notifications from the Node-RED MQTT status entity."""

import logging
from datetime import timedelta

from homeassistant.core import callback
from homeassistant.helpers.event import async_track_state_change_event, async_track_time_interval
from homeassistant.util import dt as dt_util

from .binary_sensor import employee_eligible
from .notifications import send_mobile

_LOGGER = logging.getLogger(__name__)
ENTITY = "sensor.kiln_3_status"
PAUSED_STATE = "Paused"
DEFAULT_PAUSED_SECONDS = 300
MAX_PAUSED_SECONDS = 3600


def pause_seconds(manager) -> int:
    try:
        value = int(manager["data"].get("settings", {}).get(
            "kiln_paused_delay_seconds", DEFAULT_PAUSED_SECONDS
        ))
    except (TypeError, ValueError):
        return DEFAULT_PAUSED_SECONDS
    return value if 0 <= value <= MAX_PAUSED_SECONDS else DEFAULT_PAUSED_SECONDS


async def async_setup_paused(hass, entry, manager):
    """Notify selected Kiln #3 employees once a pause lasts long enough."""
    state = manager["paused_monitor"] = {
        "since": None,
        "notified": False,
        "busy": False,
    }

    async def emit():
        settings = manager["data"].get("settings", {})
        if settings.get("kiln_paused_enabled", False) is not True:
            return
        seconds = pause_seconds(manager)
        attempted = []
        local_now = dt_util.as_local(dt_util.utcnow())
        for employee in list(manager["data"].get("employees", [])):
            if (not employee.get("use_mobile_app")
                    or not employee.get("alert_kiln_paused", False)
                    or "3" not in [str(k) for k in employee.get("kilns", [])]
                    or not employee_eligible(manager, employee, local_now)):
                continue
            try:
                await send_mobile(
                    hass,
                    employee,
                    "Kiln #3 Paused",
                    f"Kiln #3 has been paused for at least {seconds} seconds.",
                )
                result = "submitted"
            except Exception as exc:  # noqa: BLE001
                _LOGGER.warning(
                    "Kiln paused alert delivery failed for employee ID %s: %s",
                    employee.get("id"), exc,
                )
                result = "failed"
            attempted.append({"employee_id": employee.get("id"), "result": result})
        history = manager["data"].setdefault("notification_history", [])
        history.append({
            "timestamp": dt_util.utcnow().isoformat(),
            "kind": "alert_kiln_paused",
            "source": "kiln_3",
            "deliveries": attempted,
        })
        del history[:-100]
        try:
            await manager["store"].async_save(manager["data"])
        except Exception:
            _LOGGER.exception("Could not save kiln paused notification history")

    async def check(_now=None):
        if state["busy"]:
            return
        state["busy"] = True
        try:
            reading = hass.states.get(ENTITY)
            current = reading.state if reading else "unknown"
            now = dt_util.utcnow()
            if current == PAUSED_STATE:
                if state["since"] is None:
                    state["since"] = now
                    state["notified"] = False
                enabled = manager["data"].get("settings", {}).get(
                    "kiln_paused_enabled", False
                ) is True
                if (enabled and not state["notified"] and
                        (now - state["since"]).total_seconds() >= pause_seconds(manager)):
                    state["notified"] = True
                    await emit()
            else:
                state["since"] = None
                state["notified"] = False
        finally:
            state["busy"] = False

    @callback
    def on_status_change(event):
        old_state = event.data.get("old_state")
        new_state = event.data.get("new_state")
        if new_state is None or (old_state and old_state.state == new_state.state):
            return
        hass.async_create_task(check())

    # The current state is only used as the start of a fresh observation window;
    # it does not immediately send a notification after a restart.
    await check()
    entry.async_on_unload(
        async_track_state_change_event(hass, [ENTITY], on_status_change)
    )
    entry.async_on_unload(
        async_track_time_interval(hass, check, timedelta(seconds=5))
    )
