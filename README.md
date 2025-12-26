# homebridge-tesy-heater-mqtt

[![Test](https://github.com/svjakrm/homebridge-tesy-heater-mqtt/actions/workflows/test.yml/badge.svg)](https://github.com/svjakrm/homebridge-tesy-heater-mqtt/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/svjakrm/homebridge-tesy-heater-mqtt/branch/main/graph/badge.svg)](https://codecov.io/gh/svjakrm/homebridge-tesy-heater-mqtt)
[![npm version](https://badge.fury.io/js/homebridge-tesy-heater-mqtt.svg)](https://badge.fury.io/js/homebridge-tesy-heater-mqtt)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Homebridge plugin for Tesy heaters using MQTT control (Tesy API v4).

## Overview

This plugin allows you to control your Tesy smart heaters through Apple HomeKit using Homebridge. It uses the latest Tesy API v4 with MQTT for real-time device control.

**Features:**
- **Automatic device discovery** - finds all Tesy heaters in your account
- **Multi-device support** - manages multiple heaters with one configuration
- Turn heater on/off
- Set target temperature
- View current temperature
- View heating status
- Temperature range configuration
- Real-time MQTT control
- Persistent device caching

## Compatibility

This plugin has been tested and confirmed working with:
- **Tesy CN 06 100 EА CLOUD AS W**

It will most likely work with other **Tesy CN06 series** devices and possibly with other [Tesy FinEco Cloud](https://tesy.bg/produkti/otoplenie-i-grija-za-vyzduha/elektricheski-konvektori/view_group/1) convectors that support the Tesy Cloud v4 API.

If you successfully use this plugin with other Tesy models, please let us know!

## Credits

This project is based on [homebridge-tesy-heater](https://github.com/benov84/homebridge-tesy-heater) by [Dobriyan Benov](https://github.com/benov84). The original plugin was updated to work with Tesy API v4 and MQTT control protocol.

**Major changes from original:**
- **Platform plugin architecture** - complete rewrite from Accessory to Platform
- **Automatic device discovery** - finds all Tesy heaters automatically
- **Multi-device support** - manages multiple heaters with single configuration
- Migrated from Tesy API v3 to API v4
- Implemented MQTT control for device commands (real-time communication)
- Added getter for `HeatingThresholdTemperature` characteristic
- Comprehensive unit tests with 44% code coverage

## Installation

### Option 1: Install from npm (recommended)
```bash
npm install -g homebridge-tesy-heater-mqtt
```

### Option 2: Install from GitHub
```bash
npm install -g https://github.com/svjakrm/homebridge-tesy-heater-mqtt.git
```

### Option 3: Manual installation
```bash
git clone https://github.com/svjakrm/homebridge-tesy-heater-mqtt.git
cd homebridge-tesy-heater-mqtt
npm install -g .
```

## Configuration

Add this platform to your Homebridge `config.json`:

```json
{
  "platforms": [
    {
      "platform": "TesyHeater",
      "name": "TesyHeater",
      "userid": "YOUR_USER_ID",
      "username": "your.email@example.com",
      "password": "your_password",
      "maxTemp": 30,
      "minTemp": 10,
      "pullInterval": 60000
    }
  ]
}
```

**Note:** The plugin will **automatically discover** all Tesy heaters linked to your account. No need to specify device IDs!

### Configuration Parameters

| Parameter | Required | Description | Default |
|-----------|----------|-------------|---------|
| `platform` | **Yes** | Must be `TesyHeater` | - |
| `name` | **Yes** | Platform name | `TesyHeater` |
| `userid` | **Yes** | Your Tesy account user ID | - |
| `username` | **Yes** | Your Tesy account email | - |
| `password` | **Yes** | Your Tesy account password | - |
| `maxTemp` | No | Maximum temperature (°C) | `30` |
| `minTemp` | No | Minimum temperature (°C) | `10` |
| `pullInterval` | No | Status update interval (ms) | `60000` |

### How to Get Configuration Values

**Get your credentials** (`userid`, `username`, `password`):
- These are your Tesy Cloud account credentials
- `userid` can be found in the Tesy Cloud web interface or via API
- `username` is your email used to log in to Tesy Cloud
- `password` is your Tesy Cloud password

**To find your User ID**:

1. Log in to [Tesy Cloud](https://v4.mytesy.com) in your browser
2. Open Developer Tools:
   - **Chrome/Edge**: Press `F12` or right-click → **Inspect**
   - **Firefox**: Press `F12` or right-click → **Inspect Element**
   - **Safari**: First enable developer menu in **Safari → Settings → Advanced** → check "Show features for web developers", then press `Cmd+Option+I`
3. Go to the **Network** tab
4. Refresh the page (`Cmd+R` or `F5`)
5. Find a request named `get-my-devices` or `get-my-messages` in the list
6. Click on it and look for the **Payload**, **Headers**, or **Request** tab
7. Find the `userID` parameter - this is your User ID

Example:
```
GET https://ad.mytesy.com/rest/get-my-devices?userID=11111&userEmail=...
```

Your `userID` in this example is `11111`.

**That's it!** The plugin will automatically discover all devices in your account.

## Technical Details

### How it Works

1. **Device Discovery**: Fetches all devices from Tesy API v4 (`/rest/get-my-devices`) on startup
2. **Status Updates**: Polls device status periodically (default: 60 seconds)
3. **Device Control**: Single MQTT connection (`wss://mqtt.tesy.com:8083`) shared by all devices
4. **MQTT Topics**: `v1/{MAC}/request/{MODEL}/{TOKEN}/{COMMAND}`
5. **Commands**: `onOff` (power), `setTemp` (temperature), `setMode` (heating mode)
6. **Caching**: Devices persist across Homebridge restarts

### MQTT Protocol

The plugin automatically:
- Connects to Tesy MQTT broker using shared credentials
- Retrieves device-specific token and model from API
- Publishes commands to device-specific MQTT topics
- Subscribes to response topics for acknowledgments

## Troubleshooting

### Device not responding to commands
- Check that your device is online in Tesy Cloud app
- Verify your credentials are correct
- Check Homebridge logs for MQTT connection errors

### Temperature slider not showing in Home app
- Make sure you're running the latest version of this plugin
- Restart Homebridge after updating configuration
- Remove and re-add the accessory in Home app if needed

### HomeKit shows "No Response"
- Check your internet connection
- Verify Homebridge is running
- Check if device is online in Tesy Cloud

## Development

### Testing MQTT Commands

Test scripts are included in the repository:

```bash
# Test connection and monitor messages
node test-mqtt.js

# Test on/off control
node test-mqtt-control.js

# Test temperature setting
node test-mqtt-temp.js
```

### Unit Tests

The plugin includes unit tests for core functionality:

```bash
# Run tests
npm test

# Run tests with coverage report
npm run test:coverage
```

Tests cover:
- MQTT connection and initialization
- Command formatting and sending
- Device control (on/off, temperature)
- Error handling
- Configuration validation

## Support

If you find this plugin useful, consider supporting:

[![Revolut](https://img.shields.io/badge/Revolut-Support-blue)](https://revolut.me/molchaoxez)

## License

MIT License

Original work Copyright (c) 2021 Dobriyan Benov
Modified work Copyright (c) 2025 Aleksey Molchanov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

## Links

- [NPM Package](https://www.npmjs.com/package/homebridge-tesy-heater-mqtt)
- [GitHub Repository](https://github.com/svjakrm/homebridge-tesy-heater-mqtt)
- [Original Plugin](https://github.com/benov84/homebridge-tesy-heater)
- [Homebridge](https://github.com/homebridge/homebridge)
- [Tesy Cloud](https://v4.mytesy.com)
- [Tesy FinEco Cloud Convectors](https://tesy.bg/produkti/otoplenie-i-grija-za-vyzduha/elektricheski-konvektori/view_group/1)
