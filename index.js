var Service, Characteristic, API;
const mqtt = require('mqtt');
const https = require('https');
const querystring = require('querystring');

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  API = homebridge;

  homebridge.registerPlatform("homebridge-tesy-heater-mqtt", "TesyHeater", TesyHeaterPlatform, true);
};

class TesyHeaterPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;

    this.accessories = [];
    this.devices = {};
    this.mqttClient = null;

    // Configuration
    this.userid = this.config.userid;
    this.username = this.config.username;
    this.password = this.config.password;
    this.pullInterval = this.config.pullInterval || 60000;
    this.maxTemp = this.config.maxTemp || 30;
    this.minTemp = this.config.minTemp || 10;

    if (!this.userid || !this.username || !this.password) {
      this.log.error("Missing required credentials (userid, username, password) in config!");
      return;
    }

    this.log.info("TesyHeater Platform Plugin Loaded");

    if (api) {
      this.api.on('didFinishLaunching', () => {
        this.log.info("Homebridge finished launching, discovering devices...");
        this.discoverDevices();
      });
    }
  }

  configureAccessory(accessory) {
    this.log.info("Configuring cached accessory:", accessory.displayName);

    accessory.reachable = true;
    this.accessories.push(accessory);
  }

  discoverDevices() {
    this.log.info("Fetching devices from Tesy Cloud...");

    const queryParams = querystring.stringify({
      'userID': parseInt(this.userid),
      'userEmail': this.username,
      'userPass': this.password,
      'lang': 'en'
    });

    const url = 'https://ad.mytesy.com/rest/get-my-devices?' + queryParams;

    this._httpsGet(url, (error, body) => {
      if (error) {
        this.log.error("API Error:", error);
        return;
      }

      try {
        const data = JSON.parse(body);

        if (!data || Object.keys(data).length === 0) {
          this.log.warn("No devices found in your Tesy Cloud account");
          return;
        }

        this.log.info("Found %d device(s) in your account", Object.keys(data).length);

        // Initialize MQTT connection once before adding devices
        this.initMQTT();

        // Add each device
        for (const mac in data) {
          const deviceData = data[mac];
          const state = deviceData.state;

          if (!state || !state.id) {
            this.log.warn("Skipping device with MAC %s - missing state data", mac);
            continue;
          }

          // Try to get device name from various possible fields
          const deviceName = state.deviceName ||
                            state.name ||
                            deviceData.deviceName ||
                            deviceData.name ||
                            `Tesy Heater ${state.id}`;

          this.log.debug("Device data for %s:", mac, JSON.stringify({
            'state.deviceName': state.deviceName,
            'state.name': state.name,
            'deviceData.deviceName': deviceData.deviceName,
            'deviceData.name': deviceData.name,
            'using': deviceName
          }));

          this.addDevice({
            id: state.id.toString(),
            mac: mac,
            token: deviceData.token,
            model: deviceData.model || 'cn05uv',
            firmware_version: deviceData.firmware_version,
            name: deviceName,
            state: state
          });
        }

        // Remove devices that are no longer in account
        this.removeOldDevices(data);

        // Start status polling
        this.startPolling();

      } catch(e) {
        this.log.error("Error parsing device data:", e);
      }
    });
  }

  addDevice(deviceInfo) {
    const uuid = this.api.hap.uuid.generate('tesy-' + deviceInfo.id);
    let accessory = this.accessories.find(acc => acc.UUID === uuid);

    if (accessory) {
      this.log.info("Restoring existing accessory:", deviceInfo.name);

      // Always update name to ensure HomeKit has the latest value
      if (accessory.displayName !== deviceInfo.name) {
        this.log.info("Updating accessory name from '%s' to '%s'", accessory.displayName, deviceInfo.name);
      }

      // Update displayName
      accessory.displayName = deviceInfo.name;

      // Update context
      accessory.context.deviceInfo = deviceInfo;

      // Update AccessoryInformation service name
      const infoService = accessory.getService(Service.AccessoryInformation);
      if (infoService) {
        infoService.setCharacteristic(Characteristic.Name, deviceInfo.name);
      }

      // Update HeaterCooler service name
      const service = accessory.getService(Service.HeaterCooler);
      if (service) {
        service.setCharacteristic(Characteristic.Name, deviceInfo.name);
        service.displayName = deviceInfo.name;
      }

      // Also update the internal HAP accessory displayName
      if (accessory._associatedHAPAccessory) {
        accessory._associatedHAPAccessory.displayName = deviceInfo.name;
      }

      this.api.updatePlatformAccessories([accessory]);
    } else {
      this.log.info("Adding new accessory:", deviceInfo.name);
      accessory = new this.api.platformAccessory(deviceInfo.name, uuid);
      accessory.context.deviceInfo = deviceInfo;

      this.accessories.push(accessory);
      this.api.registerPlatformAccessories("homebridge-tesy-heater-mqtt", "TesyHeater", [accessory]);
    }

    // Setup accessory
    this.setupAccessory(accessory);

    // Store device reference
    this.devices[deviceInfo.id] = {
      accessory: accessory,
      info: deviceInfo
    };
  }

  removeOldDevices(currentData) {
    const currentDeviceIds = Object.values(currentData)
      .filter(d => d.state && d.state.id)
      .map(d => d.state.id.toString());

    const accessoriesToRemove = this.accessories.filter(acc => {
      if (!acc.context.deviceInfo) return false;
      return !currentDeviceIds.includes(acc.context.deviceInfo.id);
    });

    if (accessoriesToRemove.length > 0) {
      this.log.info("Removing %d device(s) that are no longer in account", accessoriesToRemove.length);
      this.api.unregisterPlatformAccessories("homebridge-tesy-heater-mqtt", "TesyHeater", accessoriesToRemove);

      accessoriesToRemove.forEach(acc => {
        const index = this.accessories.indexOf(acc);
        if (index > -1) {
          this.accessories.splice(index, 1);
        }

        if (acc.context.deviceInfo) {
          delete this.devices[acc.context.deviceInfo.id];
        }
      });
    }
  }

  setupAccessory(accessory) {
    const deviceInfo = accessory.context.deviceInfo;

    // Information Service
    const informationService = accessory.getService(Service.AccessoryInformation) ||
                               accessory.addService(Service.AccessoryInformation);

    informationService
      .setCharacteristic(Characteristic.Manufacturer, 'Tesy')
      .setCharacteristic(Characteristic.Model, deviceInfo.model || 'Convector')
      .setCharacteristic(Characteristic.SerialNumber, `${deviceInfo.id} (${deviceInfo.mac})`)
      .setCharacteristic(Characteristic.FirmwareRevision, deviceInfo.firmware_version || '0.0.0');

    // HeaterCooler Service
    let service = accessory.getService(Service.HeaterCooler);
    if (!service) {
      service = accessory.addService(Service.HeaterCooler, deviceInfo.name);
    }

    // Configure characteristics
    service.getCharacteristic(Characteristic.Active)
      .on('get', this.getActive.bind(this, deviceInfo))
      .on('set', this.setActive.bind(this, deviceInfo));

    service.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
      .on('get', this.getCurrentHeaterCoolerState.bind(this, deviceInfo))
      .updateValue(Characteristic.CurrentHeaterCoolerState.INACTIVE);

    service.getCharacteristic(Characteristic.TargetHeaterCoolerState)
      .on('get', callback => callback(null, Characteristic.TargetHeaterCoolerState.HEAT))
      .setProps({
        validValues: [Characteristic.TargetHeaterCoolerState.HEAT]
      });

    service.getCharacteristic(Characteristic.CurrentTemperature)
      .on('get', this.getCurrentTemperature.bind(this, deviceInfo))
      .setProps({ minStep: 0.1 });

    service.getCharacteristic(Characteristic.HeatingThresholdTemperature)
      .on('get', this.getHeatingThresholdTemperature.bind(this, deviceInfo))
      .on('set', this.setHeatingThresholdTemperature.bind(this, deviceInfo))
      .setProps({
        minValue: this.minTemp,
        maxValue: this.maxTemp,
        minStep: 0.5
      });

    // Cooling threshold (for HomeKit UI)
    service.getCharacteristic(Characteristic.CoolingThresholdTemperature)
      .setProps({
        minValue: this.minTemp,
        maxValue: this.maxTemp,
        minStep: 0.5
      })
      .updateValue(this.minTemp);
  }

  initMQTT() {
    if (this.mqttClient) {
      this.log.debug("MQTT client already initialized");
      return;
    }

    this.log.info("Initializing MQTT connection...");

    this.mqttClient = mqtt.connect('wss://mqtt.tesy.com:8083/mqtt', {
      username: 'client1',
      password: '123',
      clientId: 'mqttjs_' + Math.random().toString(16).substr(2, 8),
      protocol: 'wss',
      reconnectPeriod: 5000,
    });

    this.mqttClient.on('connect', () => {
      this.log.info("✓ Connected to MQTT broker");

      // Subscribe to all device response topics
      Object.values(this.devices).forEach(device => {
        const info = device.info;
        const responseTopic = `v1/${info.mac}/response/${info.model}/${info.token}/#`;
        this.mqttClient.subscribe(responseTopic, (err) => {
          if (err) {
            this.log.error("MQTT subscribe error for %s:", info.name, err);
          } else {
            this.log.debug("✓ Subscribed to MQTT topic for %s", info.name);
          }
        });
      });
    });

    this.mqttClient.on('error', (error) => {
      this.log.error("MQTT Error:", error);
    });

    this.mqttClient.on('close', () => {
      this.log.warn("MQTT connection closed");
    });

    this.mqttClient.on('offline', () => {
      this.log.warn("MQTT client offline");
    });

    // Handle incoming MQTT messages for real-time status updates
    this.mqttClient.on('message', (topic, message) => {
      try {
        // Parse topic: v1/{MAC}/response/{MODEL}/{TOKEN}/{COMMAND}
        const topicParts = topic.split('/');
        if (topicParts.length < 6) return;

        const mac = topicParts[1];
        const command = topicParts[5];

        // Only process setTempStatistic messages (periodic status updates from device)
        if (command !== 'setTempStatistic') return;

        const data = JSON.parse(message.toString());
        if (!data.payload) return;

        const payload = data.payload;

        // Find device by MAC address
        const device = Object.values(this.devices).find(d => d.info.mac === mac);
        if (!device) return;

        // Update temperatures immediately from MQTT
        // Note: setTempStatistic messages don't include 'status' (on/off) field,
        // so we'll fetch full status separately when heating state changes
        const service = device.accessory.getService(Service.HeaterCooler);
        if (!service) return;

        // Update current temperature
        if (payload.currentTemp !== undefined) {
          const currentTemp = parseFloat(payload.currentTemp);
          if (!isNaN(currentTemp)) {
            const oldTemp = service.getCharacteristic(Characteristic.CurrentTemperature).value;
            if (currentTemp !== oldTemp) {
              service.getCharacteristic(Characteristic.CurrentTemperature).updateValue(currentTemp);
              this.log.debug("%s: [MQTT] CurrentTemperature %s -> %s",
                device.info.name, oldTemp, currentTemp);
            }
          }
        }

        // Update target temperature
        if (payload.target !== undefined && payload.target > 0) {
          const targetTemp = parseFloat(payload.target);
          if (!isNaN(targetTemp) && targetTemp >= this.minTemp && targetTemp <= this.maxTemp) {
            const oldTarget = service.getCharacteristic(Characteristic.HeatingThresholdTemperature).value;
            if (targetTemp !== oldTarget) {
              service.getCharacteristic(Characteristic.HeatingThresholdTemperature).updateValue(targetTemp);
              this.log.debug("%s: [MQTT] HeatingThresholdTemperature %s -> %s",
                device.info.name, oldTarget, targetTemp);
            }
          }
        }

        // For heating state, we need full status including 'status' (on/off)
        // MQTT setTempStatistic doesn't include 'status' field
        // So we'll trigger a fetch if heating field changed
        if (payload.heating !== undefined) {
          // Fetch full status to update heating state correctly
          this.fetchDeviceStatus(device.info, (error, fullStatus) => {
            if (error) return;

            const heatingState = this._calculateHeatingState(fullStatus);
            const oldState = service.getCharacteristic(Characteristic.CurrentHeaterCoolerState).value;

            if (heatingState !== oldState) {
              service.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(heatingState);
              this.log.debug("%s: [MQTT] Heating state %s -> %s",
                device.info.name, oldState, heatingState);
            }
          });
        }
      } catch (error) {
        this.log.debug("Error processing MQTT message:", error.message);
      }
    });
  }

  sendMQTTCommand(deviceInfo, command, payload, callback) {
    if (!this.mqttClient || !this.mqttClient.connected) {
      this.log.error("MQTT not connected");
      return callback(new Error("MQTT not connected"));
    }

    const topic = `v1/${deviceInfo.mac}/request/${deviceInfo.model}/${deviceInfo.token}/${command}`;
    const message = {
      app_id: 'hb' + Math.random().toString(16).substr(2, 7),
      ...payload
    };

    this.log.debug("Sending MQTT command to %s: %s", deviceInfo.name, command);

    this.mqttClient.publish(topic, JSON.stringify(message), (err) => {
      if (err) {
        this.log.error("MQTT publish error:", err);
        callback(err);
      } else {
        callback(null);
      }
    });
  }

  fetchDeviceStatus(deviceInfo, callback) {
    const queryParams = querystring.stringify({
      'userID': parseInt(this.userid),
      'userEmail': this.username,
      'userPass': this.password,
      'lang': 'en'
    });

    const url = 'https://ad.mytesy.com/rest/get-my-devices?' + queryParams;

    this._httpsGet(url, (error, body) => {
      if (error) {
        return callback(error, null);
      }

      try {
        const data = JSON.parse(body);
        const deviceData = data[deviceInfo.mac];

        if (!deviceData || !deviceData.state) {
          return callback(new Error("Device not found"), null);
        }

        callback(null, deviceData.state);
      } catch(e) {
        callback(e, null);
      }
    });
  }

  startPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    this.log.info("Starting status polling every %d ms", this.pullInterval);

    this.pollingInterval = setInterval(() => {
      this.updateAllDevices();
    }, this.pullInterval);

    // Initial update
    this.updateAllDevices();
  }

  updateAllDevices() {
    Object.values(this.devices).forEach(device => {
      this.fetchDeviceStatus(device.info, (error, status) => {
        if (error) {
          this.log.error("Error fetching status for %s:", device.info.name, error);
          return;
        }

        this.updateAccessoryStatus(device.accessory, status);
      });
    });
  }

  updateAccessoryStatus(accessory, status) {
    const service = accessory.getService(Service.HeaterCooler);
    if (!service) return;

    try {
      // Update current temperature
      const currentTemp = parseFloat(status.current_temp);
      if (!isNaN(currentTemp) && currentTemp >= this.minTemp && currentTemp <= this.maxTemp) {
        const oldTemp = service.getCharacteristic(Characteristic.CurrentTemperature).value;
        if (currentTemp !== oldTemp) {
          service.getCharacteristic(Characteristic.CurrentTemperature).updateValue(currentTemp);
          this.log.debug("%s: CurrentTemperature %s -> %s", accessory.displayName, oldTemp, currentTemp);
        }
      }

      // Update target temperature
      const targetTemp = parseFloat(status.temp);
      if (!isNaN(targetTemp) && targetTemp >= this.minTemp && targetTemp <= this.maxTemp) {
        const oldTarget = service.getCharacteristic(Characteristic.HeatingThresholdTemperature).value;
        if (targetTemp !== oldTarget) {
          service.getCharacteristic(Characteristic.HeatingThresholdTemperature).updateValue(targetTemp);
          this.log.debug("%s: HeatingThresholdTemperature %s -> %s", accessory.displayName, oldTarget, targetTemp);
        }
      }

      // Update active status
      const isActive = status.status.toLowerCase() === 'on' ?
                       Characteristic.Active.ACTIVE :
                       Characteristic.Active.INACTIVE;
      const oldActive = service.getCharacteristic(Characteristic.Active).value;
      if (isActive !== oldActive) {
        service.getCharacteristic(Characteristic.Active).updateValue(isActive);
        this.log.info("%s: Active %s -> %s", accessory.displayName, oldActive ? 'ON' : 'OFF', isActive ? 'ON' : 'OFF');
      }

      // Update heating state
      // INACTIVE (0) = device off
      // IDLE (1) = device on, not heating (target temp reached)
      // HEATING (2) = device on and actively heating
      const heatingState = this._calculateHeatingState(status);

      const oldState = service.getCharacteristic(Characteristic.CurrentHeaterCoolerState).value;
      if (heatingState !== oldState) {
        service.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(heatingState);
        this.log.debug("%s: Heating state %s -> %s", accessory.displayName, oldState, heatingState);
      }
    } catch(e) {
      this.log.error("Error updating %s status:", accessory.displayName, e);
    }
  }

  // Characteristic Handlers

  getActive(deviceInfo, callback) {
    this.fetchDeviceStatus(deviceInfo, (error, status) => {
      if (error) {
        return callback(error);
      }

      const isActive = status.status.toLowerCase() === 'on' ?
                       Characteristic.Active.ACTIVE :
                       Characteristic.Active.INACTIVE;
      callback(null, isActive);
    });
  }

  setActive(deviceInfo, value, callback) {
    const newValue = value === 0 ? 'off' : 'on';
    this.log.info("%s: Setting active to %s", deviceInfo.name, newValue);

    this.sendMQTTCommand(deviceInfo, 'onOff', { status: newValue }, (error) => {
      if (error) {
        this.log.error("%s: Error setting active status:", deviceInfo.name, error);
        return callback(error);
      }

      this.log.info("%s: ✓ Active status changed to %s", deviceInfo.name, newValue);
      callback(null);
    });
  }

  getCurrentTemperature(deviceInfo, callback) {
    this.fetchDeviceStatus(deviceInfo, (error, status) => {
      if (error) {
        return callback(error);
      }

      const currentTemp = parseFloat(status.current_temp);
      callback(null, currentTemp);
    });
  }

  getHeatingThresholdTemperature(deviceInfo, callback) {
    this.fetchDeviceStatus(deviceInfo, (error, status) => {
      if (error) {
        return callback(error);
      }

      const targetTemp = parseFloat(status.temp);
      callback(null, targetTemp);
    });
  }

  _calculateHeatingState(status) {
    const isDeviceOn = status.status.toLowerCase() === 'on';

    if (!isDeviceOn) {
      return Characteristic.CurrentHeaterCoolerState.INACTIVE;
    }

    // Check if heating field exists and is explicit
    if (status.heating !== undefined) {
      const isHeating = status.heating === 'on';
      return isHeating ?
        Characteristic.CurrentHeaterCoolerState.HEATING :
        Characteristic.CurrentHeaterCoolerState.IDLE;
    }

    // Fallback: if heating field is missing, determine by temperature difference
    // If current temp is significantly below target, device is likely heating
    const currentTemp = parseFloat(status.current_temp) || 0;
    const targetTemp = parseFloat(status.temp) || 0;
    const tempDiff = targetTemp - currentTemp;

    // If current temp is 0.5°C or more below target, assume heating
    if (tempDiff >= 0.5) {
      return Characteristic.CurrentHeaterCoolerState.HEATING;
    } else {
      return Characteristic.CurrentHeaterCoolerState.IDLE;
    }
  }

  getCurrentHeaterCoolerState(deviceInfo, callback) {
    this.fetchDeviceStatus(deviceInfo, (error, status) => {
      if (error) {
        return callback(error);
      }

      const state = this._calculateHeatingState(status);
      callback(null, state);
    });
  }

  setHeatingThresholdTemperature(deviceInfo, value, callback) {
    // Clamp value
    if (value < this.minTemp) value = this.minTemp;
    if (value > this.maxTemp) value = this.maxTemp;

    this.log.info("%s: Setting target temperature to %s°C", deviceInfo.name, value);

    // First set mode to manual
    this.sendMQTTCommand(deviceInfo, 'setMode', { mode: 'manual' }, (error) => {
      if (error) {
        this.log.error("%s: Error setting mode to manual:", deviceInfo.name, error);
        return callback(error);
      }

      this.log.debug("%s: ✓ Mode set to manual", deviceInfo.name);

      // Then set temperature
      this.sendMQTTCommand(deviceInfo, 'setTemp', { temp: value }, (error) => {
        if (error) {
          this.log.error("%s: Error setting temperature:", deviceInfo.name, error);
          return callback(error);
        }

        this.log.info("%s: ✓ Temperature set to %s°C", deviceInfo.name, value);
        callback(null);
      });
    });
  }

  // Helper method for HTTPS GET requests
  _httpsGet(url, callback) {
    https.get(url, (response) => {
      let data = '';

      response.on('data', (chunk) => {
        data += chunk;
      });

      response.on('end', () => {
        callback(null, data);
      });
    }).on('error', (error) => {
      callback(error, null);
    });
  }
}

// Export for testing
module.exports.TesyHeaterPlatform = TesyHeaterPlatform;
