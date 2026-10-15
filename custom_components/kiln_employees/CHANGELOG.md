# Kiln Employee Manager changelog

## 1.15.2

- Collapsed advanced PLC signal details by default so the Kiln 3 page focuses
  on current status and completion settings.

## 1.15.1

- Simplified the Kiln 3 dashboard wording and completion-rule choices for
  easier operator use.

## 1.15.0

- Added per-kiln completion-rule storage and a Kiln 3 editor. The default
  remains Stopped / Idle, with options for Normal Stop, Kiln Down, or final
  step conditions.

## 1.14.0

- Added a functional Kiln 3 monitoring dashboard with live status, PLC health,
  operating signals, and links to the relevant configuration pages.

## 1.13.1

- Updated the raw PLC data display labels to identify the physical Kiln #3;
  the underlying PLC tag names remain unchanged for compatibility.

## 1.13.0

- Added a Kilns section with subpages for Kilns 1, 2, 3, and Raw PLC Data.
- Moved raw PLC diagnostics under the Kilns section to keep navigation ready
  for additional kiln configuration pages.

## 1.12.1

- PLC Data now refreshes automatically every 2 seconds while the tab is open.

## 1.12.0

- Added a read-only PLC Data tab showing the latest raw Kiln #3 tags, PLC
  clock, MQTT topic, data validity, and update timestamps.

## 1.11.3

- Fixed MQTT monitor startup so it waits for the MQTT client without treating
  the readiness helper's return value as a disable flag.

## 1.11.2

- Treats raw MQTT payloads with missing or invalid PLC operating tags as
  `Unknown` instead of reusing an older valid kiln reading.

## 1.11.1

- Changed the PLC clock stale-data timeout to 5 seconds.
- Checks heartbeat freshness every second so communication status changes
  promptly after the timeout.

## 1.11.0

- Added Home Assistant-side interpretation of raw Kiln #3 PLC MQTT data.
- Added PLC clock heartbeat tracking with a configurable stale-data timeout.
- Preserved the existing MQTT entity IDs and notification behavior during the
  migration away from Node-RED-derived kiln status.
- Node-RED can now be reduced to a read-only raw MQTT bridge on
  `plant/kiln3/raw`.

## 1.10.2

- Moved each entity row's action buttons to the right side of the row.

## 1.10.1

- Added per-entity Edit, Save, Cancel, and Remove controls.

## 1.10.0

- Removed the unused Kiln #3 completion-event entity requirement.
- Completion notifications now use `sensor.kiln_3_status` becoming exactly
  `Stopped / Idle`.

## 1.9.4

- Bumped the panel cache version so the duplicate-registration fix is loaded
  immediately by Home Assistant browsers.

## 1.9.3

- Prevented duplicate frontend custom-element registration.
- Made background task scheduling safe for Home Assistant callbacks invoked
  outside the event loop.

## 1.9.2

- Made Entity Settings read-only by default with an explicit Edit Entities
  action.
- Added cancel support and removal controls for additional entities.

## 1.9.1

- Fixed Home Assistant startup compatibility for dynamic entity listeners.

## 1.9.0

- Added an admin-only Entity Settings page with live existence/state checks.
- Moved the calendar, PLC communication, kiln status, and completion entity
  mappings into saved settings.
- Added support for storing additional named entities for future kiln alarms
  and additional kiln signals.

## 1.8.0

- Removed global enable switches for PLC communication and Kiln #3 paused
  alerts; recipient selection now controls delivery.

## 1.7.1

- Retries temporary calendar read failures before changing employee status.
- Refreshes the calendar check every 15 seconds and retains the last successful
  event set during brief service interruptions.

## 1.7.0

- Added configurable Kiln #3 paused notifications based on
  `sensor.kiln_3_status == Paused`.

## 1.6.6

- Uses Home Assistant's current target format when reading the legacy vacation
  calendar.
- Retries the calendar check after startup when `calendar.get_events` has not
  registered yet, avoiding a permanent “Vacation Check Unavailable” state.

## 1.6.5

- Reverted automatic migration when the legacy calendar is absent; this avoids
  silently ignoring a calendar that is present under a different entity ID.
- Added the calendar entity ID and current state to the diagnostic warning.

## 1.6.4

- Automatically completes the legacy vacation-calendar migration when the old
  calendar entity is absent.
- Uses the integration's built-in Time Off records without requiring a legacy
  calendar, helper, automation, or script.

## 1.6.3

- Polished section headers and action alignment.
- Replaced outdated completion-ID wording with completion-event wording.
- Expanded communication recipient labels for clarity.
- Formatted notification-history timestamps in the browser's local timezone.
- Added readable notification-history labels and submission counts.

## 1.6.2

- Changed the Kiln #3 event notification to clearly indicate that the kiln
  stopped and that completion versus manual stop still requires checking.

## 1.6.1

- Removed the charge ID from the employee-facing completion notification.
- Renamed the Node-RED signal to `sensor.kiln_3_completion_event`; its state is
  an internal changing event token, not a displayed charge identifier.

## 1.6.0

- Added Node-RED-driven Kiln #3 completion notifications.
- Uses `sensor.kiln_3_completion_id` as a unique per-charge identifier.
- Persists processed completion IDs to prevent duplicate notifications after restarts.
- Notifies only eligible employees assigned to Kiln #3.

## 1.5.0

- Added shared constants in `const.py` to remove the `__init__.py` import coupling.
- Made config-entry unload/reload lifecycle handling safer.
- Prevented duplicate registration of the process-global WebSocket commands.
- Prevented duplicate registration of the frontend static path during reloads.
- Added explicit frontend cache versioning (`panel.js?v=15`).
- Kept persistent storage schema version `1`; no employee or vacation data migration is required.

## 1.4.0

- Compact Time Off calendar interface.
