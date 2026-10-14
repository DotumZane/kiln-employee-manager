# Kiln Employee Manager changelog

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
