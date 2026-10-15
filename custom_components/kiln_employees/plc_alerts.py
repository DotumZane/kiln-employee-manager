"""Kiln #3 PLC communication alerts from existing Home Assistant state.

No PLC writes. Alerts are mobile-app only until SMS delivery is implemented.
"""
import asyncio
import logging
from datetime import datetime, timezone
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.util import dt as dt_util
from datetime import timedelta
from .notifications import send_mobile
from .binary_sensor import employee_eligible
from .const import DEFAULT_ENTITIES

_LOGGER = logging.getLogger(__name__)
ENTITY = DEFAULT_ENTITIES["kiln_3_plc_communication"]
DEFAULT_LOST_SECONDS = 30
DEFAULT_RESTORED_SECONDS = 15


def delay_seconds(manager, key, default):
    """Read the saved global delay on each check, applying safe bounds."""
    try:
        value = int(manager["data"].get("settings", {}).get(key, default))
    except (TypeError, ValueError):
        return default
    return value if 0 <= value <= 3600 else default


def _now():
    return dt_util.utcnow()


def _eligible(manager, employee):
    local_now = dt_util.as_local(_now())
    return (employee_eligible(manager, employee, local_now)
            and "3" in [str(k) for k in employee.get("kilns", [])])


async def async_setup_alerts(hass, entry, manager):
    """Observe a trusted ON baseline before ever announcing an outage."""
    state = {"phase": "initializing", "since": _now(), "outage_notified": False,
             "last_state": None, "busy": False}
    manager["plc_monitor"] = state

    async def emit(kind, title, body):
        # Apply fresh employee preferences at time of emission.
        attempted = []
        for employee in list(manager["data"].get("employees", [])):
            if not employee.get("use_mobile_app"):
                continue  # SMS remains unimplemented; do NOT silently substitute push.
            if not employee.get(kind, False) or not _eligible(manager, employee):
                continue
            try:
                await send_mobile(hass, employee, title, body)
                result = "submitted"
            except Exception as exc:
                _LOGGER.warning("PLC alert delivery failed for employee ID %s: %s",employee.get("id"),exc)
                result = "failed"
            attempted.append({"employee_id": employee.get("id"), "result": result})
        history = manager["data"].setdefault("notification_history", [])
        history.append({"timestamp": _now().isoformat(), "kind": kind,
                        "source": "kiln_3", "deliveries": attempted})
        del history[:-100]
        try:
            await manager["store"].async_save(manager["data"])
        except Exception:
            _LOGGER.exception("Could not save PLC alert history")

    async def check(_=None):
        if state["busy"]:
            return
        state["busy"] = True
        try:
            entity = manager["data"].get("settings", {}).get("kiln_configs", {}).get("3", {}).get(
                "signal_entities", {}
            ).get("communication") or manager["data"].get("entities", {}).get(
                "kiln_3_plc_communication", ENTITY
            )
            reading = hass.states.get(entity)
            current = reading.state if reading else "unknown"
            now = _now()
            if current not in ("on", "off"):
                # Never treat unknown/unavailable as a verified outage or recovery.
                state.update(phase="initializing", since=now, outage_notified=False, last_state=current)
                return
            lost_seconds = delay_seconds(manager, "plc_lost_delay_seconds", DEFAULT_LOST_SECONDS)
            restored_seconds = delay_seconds(manager, "plc_restored_delay_seconds", DEFAULT_RESTORED_SECONDS)
            phase = state["phase"]
            if phase == "initializing":
                # A stable ON baseline is required. If HA boots with the PLC off,
                # suppress alerts rather than invent an outage start.
                if current == "on":
                    if state["last_state"] != "on":
                        state["since"] = now
                    elif (now - state["since"]).total_seconds() >= restored_seconds:
                        state.update(phase="healthy", outage_notified=False)
                else:
                    state["since"] = now
                state["last_state"] = current
                return
            if phase == "healthy":
                if current == "off":
                    state.update(phase="suspected_loss", since=now)
            elif phase == "suspected_loss":
                if current == "on":
                    state.update(phase="healthy", outage_notified=False)
                elif (now - state["since"]).total_seconds() >= lost_seconds:
                    state.update(phase="outage", outage_notified=True)
                    await emit("alert_plc_lost", "Kiln #3 PLC Communication Lost",
                               f"Kiln #3 PLC communication has been unavailable for at least {lost_seconds} seconds after Home Assistant detected the loss.")
            elif phase == "outage":
                if current == "on":
                    state.update(phase="suspected_restore", since=now)
            elif phase == "suspected_restore":
                if current == "off":
                    state["phase"] = "outage"
                elif (now - state["since"]).total_seconds() >= restored_seconds:
                    was_sent = state["outage_notified"]
                    state.update(phase="healthy", outage_notified=False)
                    if was_sent:
                        await emit("alert_plc_restored", "Kiln #3 PLC Communication Restored",
                                   f"Kiln #3 PLC communication has recovered and remained stable for {restored_seconds} seconds.")
            state["last_state"] = current
        finally:
            state["busy"] = False

    unsub = async_track_time_interval(hass, check, timedelta(seconds=5))
    entry.async_on_unload(unsub)
    hass.async_create_task(check())
