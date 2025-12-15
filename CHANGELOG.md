# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.3] - 2025-12-15

### Fixed
- **Fixed Config Schema validation** (Homebridge verification requirement)
  - Removed invalid `required: true` from individual properties
  - Added proper `required` array at schema object level: `["name", "userid", "username", "password"]`
  - Config schema now passes Homebridge plugin verification checks

### Added
- **MQTT real-time status updates** (Performance improvement)
  - Added message handler for incoming MQTT `setTempStatistic` messages
  - Devices send status updates every ~10 seconds automatically
  - Temperatures (current and target) now update within 1 second of device changes
  - Heating state updates triggered on MQTT messages (with API fetch for full status)
  - Significantly faster than polling-only approach (10s vs 60s)
  - Debug logging with [MQTT] prefix to distinguish from polling updates
  - Polling still active as fallback for reliability

### Security
- **Removed deprecated `request` dependency** (Critical security fix)
  - Eliminated 2 critical vulnerabilities (form-data unsafe random, tough-cookie prototype pollution)
  - Replaced with Node.js built-in `https` module
  - Reduces package size by removing 3 vulnerable transitive dependencies
  - No functionality changes - API calls work identically
  - All 38 unit tests pass with new implementation

### Changed
- Implemented `_httpsGet()` helper method for API requests
- Updated `discoverDevices()` and `fetchDeviceStatus()` to use native HTTPS

## [1.0.2] - 2025-12-15

### Fixed
- **CurrentHeaterCoolerState now correctly shows INACTIVE when device is OFF** (Issue #8)
  - Previously, the plugin incorrectly set state to IDLE for all non-heating scenarios
  - Now properly distinguishes between three states:
    - INACTIVE (0): Device is turned OFF
    - IDLE (1): Device is ON but not actively heating (target temperature reached)
    - HEATING (2): Device is ON and actively heating
  - This fix ensures accurate status display in HomeKit app
  - Updated heating state logic in `index.js` to check both `status` and `heating` fields
  - Added comprehensive unit tests covering all three CurrentHeaterCoolerState values

- **Added GET handler for CurrentHeaterCoolerState characteristic**
  - Fixes Homebridge UI showing incorrect state ("Heat" instead of "Idle")
  - HomeKit/UI can now actively query device state on-demand
  - Polling updates continue to work via `updateValue()` for real-time updates
  - Extracted state calculation logic into reusable `_calculateHeatingState()` helper method
  - **Improved state detection with temperature-based fallback**
    - When API doesn't provide `heating` field, plugin now determines state by comparing current and target temperatures
    - Device considered HEATING when current temp is 0.5°C or more below target
    - Ensures accurate state display even when `heating` field is missing from API response
  - Added 11 new unit tests for GET handler, helper method, and fallback logic (38 total tests, 51% coverage)

## [1.0.1] - 2025-12-15

### Removed
- **homebridge-http-base** dependency (unused legacy from Accessory plugin)
  - Reduces package size by 78 transitive dependencies
  - No impact on functionality - plugin never used this dependency

### Changed
- Updated GitHub Actions: `actions/checkout@v6`, `actions/setup-node@v6`
- Updated codecov action to v5
- Improved CI/CD workflows for better Node.js 24 support

### Fixed
- Codecov coverage reporting now properly configured

## [1.0.0] - 2025-12-15

### Added
- **Platform plugin architecture** - complete rewrite from Accessory to Platform
- **Automatic device discovery** - finds all Tesy heaters in your account automatically
- **Multi-device support** - manages multiple heaters with single configuration
- Shared MQTT connection for all devices
- Device name discovery from Tesy Cloud
- Persistent device caching across restarts
- Automatic device addition/removal based on account
- GitHub Actions CI/CD workflows
- Automated testing on push and PR (Node.js 18, 20, 22, 24)
- Automated NPM publishing on version tags
- `.npmignore` file to exclude dev files from package
- Debug logging for device discovery
- Support for Node.js v24

### Changed
- **BREAKING**: Configuration format changed from `accessories` to `platforms`
- **BREAKING**: No longer requires `device_id` parameter (automatic discovery)
- Simplified configuration - only credentials needed
- Updated README with Platform configuration
- Added setup guide for GitHub Actions
- Improved logging with per-device context
- Default pullInterval changed from 10000ms to 60000ms (1 minute)
- Updated config.schema.json for Platform type with helpful UI

### Fixed
- Device name retrieval from correct API field (`deviceData.deviceName`)
- MQTT connection now shared across all devices
- Better error handling for missing credentials

### Technical
- Single MQTT connection for all devices (better resource usage)
- Devices cached by Homebridge (faster startup)
- Platform meets Homebridge Verified Plugin requirements
- Cleaner codebase with better separation of concerns

## [0.0.1] - 2025-12-15

### Added
- Initial release based on homebridge-tesy-heater
- Support for Tesy API v4
- MQTT control protocol implementation
- Real-time device control via MQTT WebSocket
- Temperature setter and getter
- On/Off control
- Current temperature reporting
- Target temperature configuration
- Unit tests with ~35% coverage
- Test scripts for MQTT debugging
- Support for Homebridge v2.x

### Changed
- Migrated from Tesy API v3 to v4
- Replaced REST API control with MQTT
- Updated configuration for Homebridge v2 compatibility
- Modernized Node.js compatibility (18.x, 20.x, 22.x)

### Fixed
- Missing getter for HeatingThresholdTemperature characteristic
- Device not responding to REST API commands
- Compatibility issues with latest Homebridge versions

### Technical Details
- MQTT broker: wss://mqtt.tesy.com:8083/mqtt
- Command topics: v1/{MAC}/request/{MODEL}/{TOKEN}/{COMMAND}
- Response topics: v1/{MAC}/response/{MODEL}/{TOKEN}/{COMMAND}
- Supported commands: onOff, setTemp, setMode

### Tested Devices
- Tesy CN 06 100 EА CLOUD AS W

[Unreleased]: https://github.com/svjakrm/homebridge-tesy-heater-mqtt/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/svjakrm/homebridge-tesy-heater-mqtt/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/svjakrm/homebridge-tesy-heater-mqtt/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/svjakrm/homebridge-tesy-heater-mqtt/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/svjakrm/homebridge-tesy-heater-mqtt/compare/v0.0.1...v1.0.0
[0.0.1]: https://github.com/svjakrm/homebridge-tesy-heater-mqtt/releases/tag/v0.0.1
