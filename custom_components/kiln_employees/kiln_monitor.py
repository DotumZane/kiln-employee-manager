"""Interpret configured raw PLC MQTT data inside Home Assistant."""

import json
import logging
from datetime import timedelta

from homeassistant.components import mqtt
from homeassistant.core import HomeAssistant
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.util import dt as dt_util

from .const import (
    KILN_3_COMMUNICATION_MQTT_TOPIC, KILN_3_CURRENT_STEP_MQTT_TOPIC,
    KILN_3_DOWN_MQTT_TOPIC, KILN_3_FINAL_STEP_MQTT_TOPIC,
    KILN_3_NORMAL_STOP_MQTT_TOPIC, KILN_3_PAUSED_MQTT_TOPIC,
    KILN_3_RAW_MQTT_TOPIC, KILN_3_STATUS_MQTT_TOPIC,
)

_LOGGER = logging.getLogger(__name__)
_DEFAULT_TAGS = {
    "on": "Kiln1_ON", "pause": "Kiln1_Pause", "clock": "PLC_ClockValues[5]",
    "normal_stop": "Program:Kiln1.Normal_Stop",
    "kiln_down": "Program:Kiln1.Kiln_Down",
    "step_number": "Program:Kiln1.Step_Number",
    "step_stop": "Program:Kiln1.Step_Stop",
}


def _tags(config: dict) -> dict:
    configured = config.get("tags") if isinstance(config.get("tags"), dict) else {}
    return {key: str(configured.get(key) or value) for key, value in _DEFAULT_TAGS.items()}


def _normalize(raw: dict, config: dict) -> dict:
    configured = _tags(config)
    return {logical: raw[tag] for logical, tag in configured.items() if tag in raw}


def _validated(values: dict) -> dict | None:
    required = {"on", "pause", "normal_stop", "kiln_down", "step_number", "step_stop"}
    if not required.issubset(values):
        return None
    result = {}
    for name in required:
        value = values[name]
        if name in {"on", "pause", "normal_stop", "kiln_down"}:
            if value in (1, "true"):
                value = True
            elif value in (0, "false"):
                value = False
            if type(value) is not bool:
                return None
        elif type(value) is not int:
            return None
        result[name] = value
    return result


def _status(values: dict) -> tuple[str, bool, bool, bool]:
    running = values["on"] is True and values["pause"] is False
    paused = values["on"] is False and values["pause"] is True
    stopped = values["on"] is False and values["pause"] is False
    if running:
        return "Running", running, paused, stopped
    if paused:
        return "Paused", running, paused, stopped
    if stopped:
        return "Stopped / Idle", running, paused, stopped
    return "Unexpected State", running, paused, stopped


async def async_setup_monitor(hass: HomeAssistant, entry, manager: dict) -> None:
    """Subscribe to configured Kiln 3 raw data and publish its legacy topics."""
    await mqtt.async_wait_for_mqtt_client(hass)
    config = manager["data"].get("settings", {}).get("kiln_configs", {}).get("3", {})
    runtime_config = dict(config)
    raw_topic = str(runtime_config.get("raw_topic") or KILN_3_RAW_MQTT_TOPIC)
    try:
        heartbeat_timeout = max(1, min(3600, int(runtime_config.get("heartbeat_timeout_seconds", 5))))
    except (TypeError, ValueError):
        heartbeat_timeout = 5
    state = manager["kiln_monitor"] = {
        "last_clock": None, "last_clock_change": None, "values": None,
        "data_valid": False, "raw": {}, "last_received": None,
        "last_clock_received": None, "last_status": "Unknown",
        "last_published_connected": None, "topic": raw_topic,
        "heartbeat_timeout_seconds": heartbeat_timeout, "tags": _tags(runtime_config),
    }

    async def publish(topic: str, payload) -> None:
        await mqtt.async_publish(hass, topic, payload, qos=0, retain=False)

    async def publish_unknown(communication_ok: bool) -> None:
        await publish(KILN_3_STATUS_MQTT_TOPIC, json.dumps({
            "status": "Unknown", "dataFresh": False, "communicationOK": communication_ok,
        }))
        await publish(KILN_3_COMMUNICATION_MQTT_TOPIC, "OFF")

    async def publish_current() -> None:
        values = state["values"]
        fresh = (state["last_clock_change"] is not None and
                 hass.loop.time() - state["last_clock_change"] <= heartbeat_timeout)
        if not fresh or values is None or not state["data_valid"]:
            if state["last_published_connected"] is not False:
                await publish_unknown(fresh)
                state["last_published_connected"] = False
            return
        status, running, paused, stopped = _status(values)
        state["last_status"] = status
        await publish(KILN_3_STATUS_MQTT_TOPIC, json.dumps({
            "status": status, "dataFresh": True, "communicationOK": True,
            "running": running, "paused": paused, "stopped": stopped,
            "normalStop": values["normal_stop"], "kilnDown": values["kiln_down"],
            "currentStep": values["step_number"], "finalStep": values["step_stop"],
            "onFinalStep": values["step_number"] == values["step_stop"] and values["step_stop"] > 0,
            "pastFinalStep": values["step_number"] > values["step_stop"] and values["step_stop"] > 0,
        }))
        await publish(KILN_3_COMMUNICATION_MQTT_TOPIC, "ON")
        await publish(KILN_3_CURRENT_STEP_MQTT_TOPIC, str(values["step_number"]))
        await publish(KILN_3_FINAL_STEP_MQTT_TOPIC, str(values["step_stop"]))
        await publish(KILN_3_NORMAL_STOP_MQTT_TOPIC, "ON" if values["normal_stop"] else "OFF")
        await publish(KILN_3_DOWN_MQTT_TOPIC, "ON" if values["kiln_down"] else "OFF")
        await publish(KILN_3_PAUSED_MQTT_TOPIC, "ON" if paused else "OFF")
        state["last_published_connected"] = True

    async def on_message(msg) -> None:
        try:
            raw = json.loads(msg.payload)
        except (TypeError, json.JSONDecodeError):
            _LOGGER.warning("Ignoring invalid raw Kiln #3 MQTT payload")
            return
        if not isinstance(raw, dict):
            return
        state["raw"] = raw
        state["last_received"] = dt_util.utcnow().isoformat()
        incoming = _normalize(raw, runtime_config)
        clock = incoming.get("clock")
        if type(clock) is int and clock != state["last_clock"]:
            state["last_clock"] = clock
            state["last_clock_change"] = hass.loop.time()
            state["last_clock_received"] = dt_util.utcnow().isoformat()
        values = _validated(incoming)
        state["values"] = values if values is not None else state["values"]
        state["data_valid"] = values is not None
        await publish_current()

    async def on_tick(_now) -> None:
        await publish_current()

    unsubscribe = await mqtt.async_subscribe(hass, raw_topic, on_message, qos=0)

    async def reconfigure(new_config: dict) -> None:
        """Apply saved setup without discarding the current PLC reading."""
        nonlocal runtime_config, raw_topic, heartbeat_timeout, unsubscribe
        new_topic = str(new_config.get("raw_topic") or KILN_3_RAW_MQTT_TOPIC)
        try:
            new_timeout = max(1, min(3600, int(new_config.get("heartbeat_timeout_seconds", 5))))
        except (TypeError, ValueError):
            new_timeout = 5
        if new_topic != raw_topic:
            unsubscribe()
            unsubscribe = await mqtt.async_subscribe(hass, new_topic, on_message, qos=0)
        runtime_config = dict(new_config)
        raw_topic = new_topic
        heartbeat_timeout = new_timeout
        state["topic"] = raw_topic
        state["heartbeat_timeout_seconds"] = heartbeat_timeout
        state["tags"] = _tags(runtime_config)
        if state["raw"]:
            values = _validated(_normalize(state["raw"], runtime_config))
            if values is not None:
                state["values"] = values
                state["data_valid"] = True
        await publish_current()

    manager["kiln_monitor_reconfigure"] = reconfigure
    entry.async_on_unload(lambda: unsubscribe())
    entry.async_on_unload(lambda: manager.pop("kiln_monitor_reconfigure", None))
    entry.async_on_unload(async_track_time_interval(hass, on_tick, timedelta(seconds=1)))
    await publish_current()
