"""Shared constants for the Kiln Employee Manager integration."""

DOMAIN = "kiln_employees"
INTEGRATION_VERSION = "1.5.0"

# Persistent storage schema version.  Keep this separate from the integration
# version: changing code does not automatically require a data migration.
STORAGE_VERSION = 1
STORAGE_KEY = "kiln_employee_manager"

PANEL_URL_PATH = "kiln-employees"
PANEL_STATIC_URL = "/kiln-employees-static/panel.js"
PANEL_CACHE_VERSION = 21
DEFAULT_ENTITIES = {
    "time_off_calendar": "calendar.kiln_employee_time_off",
    "kiln_3_status": "sensor.kiln_3_status",
    "kiln_3_plc_communication": "binary_sensor.kiln_3_plc_communication",
}
ENTITY_LABELS = {
    "time_off_calendar": "Employee Time-Off Calendar",
    "kiln_3_status": "Kiln #3 Status",
    "kiln_3_plc_communication": "Kiln #3 PLC Communication",
}
COMPLETION_ENTITY = DEFAULT_ENTITIES["kiln_3_status"]
WS_REGISTERED_KEY = f"{DOMAIN}_websocket_registered"
STATIC_REGISTERED_KEY = f"{DOMAIN}_static_registered"

