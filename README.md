# homebridge-tesy-heater-mqtt

[![Test](https://github.com/svjakrm/homebridge-tesy-heater-mqtt/actions/workflows/test.yml/badge.svg)](https://github.com/svjakrm/homebridge-tesy-heater-mqtt/actions/workflows/test.yml)
[![npm version](https://badge.fury.io/js/homebridge-tesy-heater-mqtt.svg)](https://badge.fury.io/js/homebridge-tesy-heater-mqtt)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Homebridge plugin for Tesy heaters using MQTT control (Tesy API v4).

## Overview

This plugin allows you to control your Tesy smart heaters through Apple HomeKit using Homebridge. It uses the latest Tesy API v4 with MQTT for real-time device control.

**Features:**
- Turn heater on/off
- Set target temperature
- View current temperature
- View heating status
- Temperature range configuration

## Compatibility

This plugin has been tested and confirmed working with:
- **Tesy CN 06 100 EА CLOUD AS W**

It will most likely work with other **Tesy CN06 series** devices and possibly with other [Tesy FinEco Cloud](https://tesy.bg/produkti/otoplenie-i-grija-za-vyzduha/elektricheski-konvektori/view_group/1) convectors that support the Tesy Cloud v4 API.

If you successfully use this plugin with other Tesy models, please let us know!

## Credits

This project is based on [homebridge-tesy-heater](https://github.com/benov84/homebridge-tesy-heater) by [Dobriyan Benov](https://github.com/benov84). The original plugin was updated to work with Tesy API v4 and MQTT control protocol.

**Major changes from original:**
- Migrated from Tesy API v3 to API v4
- Implemented MQTT control for device commands
- Added `mqtt` dependency for real-time communication
- Removed obsolete authentication methods
- Added getter for `HeatingThresholdTemperature` characteristic

## Installation

### Option 1: Install from npm (when published)
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

Add this accessory to your Homebridge `config.json`:

```json
{
  "accessories": [
    {
      "accessory": "TesyHeater",
      "name": "Living Room Heater",
      "userid": "YOUR_USER_ID",
      "username": "your.email@example.com",
      "password": "your_password",
      "device_id": "YOUR_DEVICE_ID",
      "maxTemp": 30,
      "minTemp": 10,
      "pullInterval": 60000
    }
  ]
}
```

### Configuration Parameters

| Parameter | Required | Description | Default |
|-----------|----------|-------------|---------|
| `accessory` | **Yes** | Must be `TesyHeater` | - |
| `name` | **Yes** | Name of your heater in HomeKit | - |
| `userid` | **Yes** | Your Tesy account user ID | - |
| `username` | **Yes** | Your Tesy account email | - |
| `password` | **Yes** | Your Tesy account password | - |
| `device_id` | **Yes** | Device ID from Tesy Cloud | - |
| `maxTemp` | No | Maximum temperature (°C) | `30` |
| `minTemp` | No | Minimum temperature (°C) | `10` |
| `pullInterval` | No | Status update interval (ms) | `10000` |

### How to Get Configuration Values

1. **Get your credentials** (`userid`, `username`, `password`):
   - These are your Tesy Cloud account credentials
   - `userid` can be found in the Tesy Cloud web interface
   - `username` is your email used to log in
   - `password` is your Tesy Cloud password

2. **Get device_id**:

   Run this command (replace with your credentials):
   ```bash
   curl -s 'https://ad.mytesy.com/rest/get-my-devices?userID=YOUR_USER_ID&userEmail=YOUR_EMAIL&userPass=YOUR_PASSWORD&lang=en' | python3 -m json.tool
   ```

   Look for your device in the response. The `device_id` is found in the `state.id` field:
   ```json
   {
     "AA:BB:CC:DD:EE:FF": {
       "token": "abc1234",
       "state": {
         "id": 123456,  // <-- This is your device_id
         "mac": "AA:BB:CC:DD:EE:FF",
         "deviceName": null,
         "status": "on",
         ...
       }
     }
   }
   ```

## Technical Details

### How it Works

1. **Status Updates**: Uses Tesy API v4 (`/rest/get-my-devices`) to poll device status
2. **Device Control**: Connects to Tesy MQTT broker (`wss://mqtt.tesy.com:8083`) for real-time commands
3. **MQTT Topics**: `v1/{MAC}/request/{MODEL}/{TOKEN}/{COMMAND}`
4. **Commands**: `onOff` (power), `setTemp` (temperature), `setMode` (heating mode)

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

- [GitHub Repository](https://github.com/svjakrm/homebridge-tesy-heater-mqtt)
- [Original Plugin](https://github.com/benov84/homebridge-tesy-heater)
- [Homebridge](https://github.com/homebridge/homebridge)
- [Tesy Cloud](https://v4.mytesy.com)
- [Tesy FinEco Cloud Convectors](https://tesy.bg/produkti/otoplenie-i-grija-za-vyzduha/elektricheski-konvektori/view_group/1)
