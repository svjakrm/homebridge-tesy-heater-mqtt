# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/svjakrm/homebridge-tesy-heater-mqtt/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/svjakrm/homebridge-tesy-heater-mqtt/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/svjakrm/homebridge-tesy-heater-mqtt/compare/v0.0.1...v1.0.0
[0.0.1]: https://github.com/svjakrm/homebridge-tesy-heater-mqtt/releases/tag/v0.0.1
