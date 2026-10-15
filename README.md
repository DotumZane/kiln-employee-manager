# Kiln Employee Manager

Home Assistant custom integration for employee scheduling, time off, alert
eligibility, and mobile notification routing for kiln operations.

## Installation with HACS

Add this repository to HACS as a custom **Integration** repository. HACS will
install the integration under `custom_components/kiln_employees` and provide
versioned updates from GitHub.

After installing or updating Python code, restart Home Assistant once so the
new integration modules are loaded. Runtime employee and alert settings can be
reloaded through the Home Assistant integration reload control.

## Current version

The current release is **1.15.0**. See
[`custom_components/kiln_employees/CHANGELOG.md`](custom_components/kiln_employees/CHANGELOG.md)
for release notes.

## Node-RED kiln status signal

Node-RED reads the PLC and publishes the raw JSON tag object to
`plant/kiln3/raw`. The integration interprets the raw data, tracks the
`PLC_ClockValues[5]` heartbeat with a five-second stale-data timeout, publishes the existing Kiln #3 MQTT entity
topics, and owns pause/stop/completion decisions. Node-RED must no longer
publish the derived `plant/kiln3/status` and related value topics after the
cutover, or the two publishers could race.

For the cutover, add a second MQTT path directly from the EtherNet/IP node
before the `Kiln 3 Status` function. The Function node on that path can use:

```javascript
if (!msg.payload || typeof msg.payload !== "object" || Array.isArray(msg.payload)) {
    return null;
}
msg.topic = "plant/kiln3/raw";
msg.payload = JSON.stringify(msg.payload);
return msg;
```

Deploy that path and confirm the integration is publishing the normal derived
topics. Then disable the old Node-RED path that publishes
`plant/kiln3/status`, `plant/kiln3/communication`, and the individual kiln
value topics. Leave the raw path running.

The stop notification uses the exact state `Stopped / Idle`. The value is not
included in the employee notification. The integration sends:

> Kiln #3 has stopped. Check whether the drying schedule completed or the kiln was manually stopped.
