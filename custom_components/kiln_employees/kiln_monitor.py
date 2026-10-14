"""Interpret raw Kiln #3 PLC MQTT data inside Home Assistant.

Node-RED remains a read-only PLC-to-MQTT bridge.  This module owns the
heartbeat and operating-state interpretation so completion and pause alerts do
not depend on Node-RED's derived status message.
"""

import json
import logging
from datetime import timedelta

from homeassistant.components import mqtt
from homeassistant.core import HomeAssistant
from homeassistant.helpers.event import async_track_time_interval

from .const import (
    KILN_3_COMMUNICATION_MQTT_TOPIC,
    KILN_3_CURRENT_STEP_MQTT_TOPIC,
    KILN_3_DOWN_MQTT_TOPIC,
    KILN_3_FINAL_STEP_MQTT_TOPIC,
    KILN_3_NORMAL_STOP_MQTT_TOPIC,
    KILN_3_PAUSED_MQTT_TOPIC,
    KILN_3_RAW_MQTT_TOPIC,
    KILN_3_STATUS_MQTT_TOPIC,
)

_LOGGER = logging.getLogger(__name__)
_PREFIX = "Program:Kiln1."
_CLOCK = "PLC_ClockValues[5]"
_HEARTBEAT_TIMEOUT = 5
_BOOL_TAGS = {"Kiln1_ON", "Kiln1_Pause", "Normal_Stop", "Kiln_Down"}
_REQUIRED = _BOOL_TAGS | {"Step_Number", "Step_Stop"}


def _normalize(raw: dict) -> dict:
    values = {}
    for key, value in raw.items():
        name = key[len(_PREFIX):] if key.startswith(_PREFIX) else key
        values[name] = value
    return values


def _validated(values: dict) -> dict | None:
    if not _REQUIRED.issubset(values):
        return None
    result = {}
    for name in _REQUIRED:
        value = values[name]
        if name in _BOOL_TAGS:
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
    running = values["Kiln1_ON"] is True and values["Kiln1_Pause"] is False
    paused = values["Kiln1_ON"] is False and values["Kiln1_Pause"] is True
    stopped = values["Kiln1_ON"] is False and values["Kiln1_Pause"] is False
    if running:
        return "Running", running, paused, stopped
    if paused:
        return "Paused", running, paused, stopped
    if stopped:
        return "Stopped / Idle", running, paused, stopped
    return "Unexpected State", running, paused, stopped


async def async_setup_monitor(hass: HomeAssistant, entry, manager: dict) -> None:
    """Subscribe to raw PLC data and publish the existing derived MQTT topics."""
    if not await mqtt.async_wait_for_mqtt_client(hass):
        _LOGGER.warning("MQTT is unavailable; Kiln #3 raw monitoring is disabled")
        return

    state = manager["kiln_monitor"] = {
        "last_clock": None,
        "last_clock_change": None,
        "values": None,
        "last_published_connected": None,
    }

    async def publish(topic: str, payload, *, retain: bool = False) -> None:
        await mqtt.async_publish(hass, topic, payload, qos=0, retain=retain)

    async def publish_unknown() -> None:
        data = {
            "status": "Unknown",
            "dataFresh": False,
            "communicationOK": False,
        }
        await publish(KILN_3_STATUS_MQTT_TOPIC, json.dumps(data))
        await publish(KILN_3_COMMUNICATION_MQTT_TOPIC, "OFF")

    async def publish_current() -> None:
        values = state["values"]
        now = hass.loop.time()
        fresh = (
            state["last_clock_change"] is not None
            and now - state["last_clock_change"] <= _HEARTBEAT_TIMEOUT
        )
        if not fresh or values is None:
            if state["last_published_connected"] is not False:
                await publish_unknown()
                state["last_published_connected"] = False
            return

        status, running, paused, stopped = _status(values)
        data = {
            "status": status,
            "dataFresh": True,
            "communicationOK": True,
            "running": running,
            "paused": paused,
            "stopped": stopped,
            "normalStop": values["Normal_Stop"],
            "kilnDown": values["Kiln_Down"],
            "currentStep": values["Step_Number"],
            "finalStep": values["Step_Stop"],
            "onFinalStep": values["Step_Number"] == values["Step_Stop"] and values["Step_Stop"] > 0,
            "pastFinalStep": values["Step_Number"] > values["Step_Stop"] and values["Step_Stop"] > 0,
        }
        await publish(KILN_3_STATUS_MQTT_TOPIC, json.dumps(data))
        await publish(KILN_3_COMMUNICATION_MQTT_TOPIC, "ON")
        await publish(KILN_3_CURRENT_STEP_MQTT_TOPIC, str(values["Step_Number"]))
        await publish(KILN_3_FINAL_STEP_MQTT_TOPIC, str(values["Step_Stop"]))
        await publish(KILN_3_NORMAL_STOP_MQTT_TOPIC, "ON" if values["Normal_Stop"] else "OFF")
        await publish(KILN_3_DOWN_MQTT_TOPIC, "ON" if values["Kiln_Down"] else "OFF")
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
        incoming = _normalize(raw)
        clock = incoming.get(_CLOCK)
        if type(clock) is int and clock != state["last_clock"]:
            state["last_clock"] = clock
            state["last_clock_change"] = hass.loop.time()
        values = _validated(incoming)
        if values is not None:
            state["values"] = values
        await publish_current()

    async def on_tick(_now) -> None:
        await publish_current()

    unsubscribe = await mqtt.async_subscribe(
            hass, KILN_3_RAW_MQTT_TOPIC, on_message, qos=0
    )
    entry.async_on_unload(unsubscribe)
    entry.async_on_unload(
        async_track_time_interval(
            hass, on_tick, timedelta(seconds=1)
        )
    )
    await publish_current()
