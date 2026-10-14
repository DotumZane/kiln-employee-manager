"""Kiln Employee Manager: local employee storage and live schedule indicators."""
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from pathlib import Path

from . import panel_api
from .const import (
    DOMAIN,
    PANEL_CACHE_VERSION,
    PANEL_STATIC_URL,
    PANEL_URL_PATH,
    STATIC_REGISTERED_KEY,
    STORAGE_KEY,
    STORAGE_VERSION,
    DEFAULT_ENTITIES,
)
from .plc_alerts import async_setup_alerts
from .completion import async_setup_completion
from .kiln_paused import async_setup_paused
from .kiln_monitor import async_setup_monitor
from homeassistant.const import Platform

PLATFORM_LIST = [Platform.BINARY_SENSOR, Platform.SENSOR, Platform.SWITCH]


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    hass.data.setdefault(DOMAIN, {})
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    data = await store.async_load()
    if data is None:
        data = {
            "employees": [],
            "settings": {
                "before_shift_minutes": 15,
                "after_shift_minutes": 15,
                "max_employees": 10,
            },
        }
        await store.async_save(data)
    data.setdefault("employees", [])
    data.setdefault("time_off", [])
    data.setdefault("time_off_migrated", False)
    data.setdefault("entities", dict(DEFAULT_ENTITIES))
    for key, default in DEFAULT_ENTITIES.items():
        data["entities"].setdefault(key, default)
    data.setdefault("additional_entities", [])
    data.setdefault("settings", {})
    data["settings"].setdefault("plc_lost_delay_seconds", 30)
    data["settings"].setdefault("plc_restored_delay_seconds", 15)
    data["settings"].setdefault("kiln_paused_delay_seconds", 300)

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = {
        "store": store,
        "data": data,
        "listeners": set(),
    }
    try:
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORM_LIST)
    except Exception:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        raise
    # WebSocket commands are process-global in Home Assistant and cannot be
    # unregistered by custom integrations. Register them once; their handlers
    # resolve the currently loaded manager at call time.
    panel_api.register(hass)
    await async_setup_alerts(hass, entry, hass.data[DOMAIN][entry.entry_id])
    await async_setup_completion(hass, entry, hass.data[DOMAIN][entry.entry_id])
    await async_setup_paused(hass, entry, hass.data[DOMAIN][entry.entry_id])
    await async_setup_monitor(hass, entry, hass.data[DOMAIN][entry.entry_id])
    # Static paths are also process-global and have no supported removal API.
    # Register once so an integration reload does not attempt to register a
    # duplicate path.
    if not hass.data.get(STATIC_REGISTERED_KEY):
        await hass.http.async_register_static_paths([
            StaticPathConfig(
                PANEL_STATIC_URL,
                str(Path(__file__).parent / "panel.js"),
                False,
            )
        ])
        hass.data[STATIC_REGISTERED_KEY] = True
    await panel_custom.async_register_panel(
        hass,
        webcomponent_name='kiln-employees-panel',
        frontend_url_path=PANEL_URL_PATH,
        module_url=f'{PANEL_STATIC_URL}?v={PANEL_CACHE_VERSION}',
        sidebar_title='Kiln Employees',
        sidebar_icon='mdi:account-group',
        require_admin=True,
    )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORM_LIST):
        return False
    hass.data[DOMAIN].pop(entry.entry_id, None)
    # The panel is tied to the config entry and must be removed so a subsequent
    # config-entry reload can register the current panel definition again.
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    return True
