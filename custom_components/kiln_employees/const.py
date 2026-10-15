"""Shared constants for the Kiln Employee Manager integration."""

DOMAIN = "kiln_employees"
INTEGRATION_VERSION = "1.15.0"

# Persistent storage schema version.  Keep this separate from the integration
# version: changing code does not automatically require a data migration.
STORAGE_VERSION = 1
STORAGE_KEY = "kiln_employee_manager"

PANEL_URL_PATH = "kiln-employees"
PANEL_STATIC_URL = "/kiln-employees-static/panel.js"
PANEL_CACHE_VERSION = 29
DEFAULT_ENTITIES = {
    "time_off_calendar": "calendar.kiln_employee_time_off",
    "kiln_3_status": "sensor.kiln_3_status",
    "kiln_3_plc_communication": "binary_sensor.kiln_3_plc_communication",
}
KILN_3_RAW_MQTT_TOPIC = "plant/kiln3/raw"
KILN_3_STATUS_MQTT_TOPIC = "plant/kiln3/status"
KILN_3_COMMUNICATION_MQTT_TOPIC = "plant/kiln3/communication"
KILN_3_CURRENT_STEP_MQTT_TOPIC = "plant/kiln3/current_step"
KILN_3_FINAL_STEP_MQTT_TOPIC = "plant/kiln3/final_step"
KILN_3_NORMAL_STOP_MQTT_TOPIC = "plant/kiln3/normal_stop"
KILN_3_DOWN_MQTT_TOPIC = "plant/kiln3/down"
KILN_3_PAUSED_MQTT_TOPIC = "plant/kiln3/paused"
COMPLETION_RULES = {
    "stopped_idle": "Stopped / Idle",
    "normal_stop_or_down": "Normal Stop or Kiln Down",
    "normal_stop": "Normal Stop",
    "kiln_down": "Kiln Down",
    "final_step": "At or past the final step",
}
ENTITY_LABELS = {
    "time_off_calendar": "Employee Time-Off Calendar",
    "kiln_3_status": "Kiln #3 Status",
    "kiln_3_plc_communication": "Kiln #3 PLC Communication",
}
COMPLETION_ENTITY = DEFAULT_ENTITIES["kiln_3_status"]
WS_REGISTERED_KEY = f"{DOMAIN}_websocket_registered"
STATIC_REGISTERED_KEY = f"{DOMAIN}_static_registered"

