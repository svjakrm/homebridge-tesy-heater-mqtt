var Service, Characteristic;
const _http_base = require("homebridge-http-base");
const PullTimer = _http_base.PullTimer;
const mqtt = require('mqtt');

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory("homebridge-tesy-heater-mqtt", "TesyHeater", TesyHeater);
  return TesyHeater; // Export class for testing
};

class TesyHeater {

  constructor(log, config) {
    this.log = log;

    this.name = config.name;
    this.manufacturer = config.manufacturer || 'Tesy';
    this.model = config.model || 'Convector (Heater)';
    this.device_id = config.device_id;
    this.pullInterval = config.pullInterval || 10000;
    this.maxTemp = config.maxTemp || 30;
    this.minTemp = config.minTemp || 10;

    this.userid = config.userid || null;
    this.username = config.username || null;
    this.password = config.password || null;
    this.device_mac = null; // Will be found from device_id
    this.device_token = null; // Will be found from API
    this.device_model = null; // Will be found from API
    this.app_id = 'hb' + Math.random().toString(16).substr(2, 7); // Random app ID for homebridge
    this.mqttClient = null;

    this.log.info(this.name);

    this.service = new Service.HeaterCooler(this.name);

    // Start pull timer immediately - no login required with new API
    this.pullTimer = new PullTimer(this.log, this.pullInterval, this.refreshTesyHeaterStatus.bind(this), () => {});
    this.pullTimer.start();
  }

  identify(callback) {
    this.log.info("Hi, I'm ", this.name);
    callback();
  }

  getTesyHeaterActiveState(state) {
    if (state.toLowerCase() === 'on')
      return Characteristic.Active.ACTIVE;
    else
      return Characteristic.Active.INACTIVE;
  }

  getTesyHeaterCurrentHeaterCoolerState(state) {
    if (state.toUpperCase() === 'READY')
      return Characteristic.CurrentHeaterCoolerState.IDLE;
    else
      return Characteristic.CurrentHeaterCoolerState.HEATING;
  }

  // Helper method to fetch device data from new API
  fetchDeviceData(callback) {
    var querystring = require('querystring');
    var request = require('request');

    var queryParams = querystring.stringify({
      'userID': parseInt(this.userid),
      'userEmail': this.username,
      'userPass': this.password,
      'lang': 'en'
    });

    var options = {
      'method': 'GET',
      'url': 'https://ad.mytesy.com/rest/get-my-devices?' + queryParams
    };

    var that = this;
    request(options, function (error, response) {
      if (error) {
        that.log.error("API Error:", error);
        callback(error, null);
        return;
      }

      try {
        var data = JSON.parse(response.body);

        if (!data || Object.keys(data).length === 0) {
          callback(new Error("No device data"), null);
          return;
        }

        // Find device
        var deviceData = null;
        if (that.device_mac && data[that.device_mac]) {
          deviceData = data[that.device_mac];
        } else {
          for (var mac in data) {
            if (data[mac].state && data[mac].state.id == that.device_id) {
              deviceData = data[mac];
              that.device_mac = mac;
              that.device_token = deviceData.token;
              that.device_model = deviceData.model;
              that.log.info("Found device: MAC=%s, Token=%s, Model=%s", that.device_mac, that.device_token, that.device_model);

              // Initialize MQTT connection once we have device info
              if (!that.mqttClient) {
                that.initMQTT();
              }
              break;
            }
          }
        }

        if (!deviceData || !deviceData.state) {
          callback(new Error("Device not found"), null);
          return;
        }

        callback(null, deviceData.state);
      } catch(e) {
        that.log.error("Parse error:", e);
        callback(e, null);
      }
    });
  }

  // Initialize MQTT connection
  initMQTT() {
    this.log.info("Initializing MQTT connection...");

    this.mqttClient = mqtt.connect('wss://mqtt.tesy.com:8083/mqtt', {
      username: 'client1',
      password: '123',
      clientId: 'mqttjs_' + Math.random().toString(16).substr(2, 8),
      protocol: 'wss',
      reconnectPeriod: 5000,
    });

    var that = this;

    this.mqttClient.on('connect', function () {
      that.log.info("✓ Connected to MQTT broker");

      // Subscribe to response topics
      const responseTopic = `v1/${that.device_mac}/response/${that.device_model}/${that.device_token}/#`;
      that.mqttClient.subscribe(responseTopic, function (err) {
        if (err) {
          that.log.error("MQTT subscribe error:", err);
        } else {
          that.log.info("✓ Subscribed to MQTT topic:", responseTopic);
        }
      });
    });

    this.mqttClient.on('error', function (error) {
      that.log.error("MQTT Error:", error);
    });

    this.mqttClient.on('close', function () {
      that.log.warn("MQTT connection closed");
    });

    this.mqttClient.on('offline', function () {
      that.log.warn("MQTT client offline");
    });
  }

  // Send MQTT command
  sendMQTTCommand(command, payload, callback) {
    if (!this.mqttClient || !this.mqttClient.connected) {
      this.log.error("MQTT not connected");
      callback(new Error("MQTT not connected"));
      return;
    }

    if (!this.device_mac || !this.device_token || !this.device_model) {
      this.log.error("Device info not available");
      callback(new Error("Device info not available"));
      return;
    }

    const topic = `v1/${this.device_mac}/request/${this.device_model}/${this.device_token}/${command}`;
    const message = {
      app_id: this.app_id,
      ...payload
    };

    this.log.info("Sending MQTT command:", command, "Payload:", JSON.stringify(message));

    this.mqttClient.publish(topic, JSON.stringify(message), function(err) {
      if (err) {
        this.log.error("MQTT publish error:", err);
        callback(err);
      } else {
        callback(null);
      }
    }.bind(this));
  }

  refreshTesyHeaterStatus() {
    this.log.debug("Executing RefreshTesyHeaterStatus");

    if (this.pullTimer) {
      this.pullTimer.stop();
    }

    var that = this;

    this.fetchDeviceData(function(error, status) {
      if (error) {
        that.service.getCharacteristic(Characteristic.Active).updateValue(Characteristic.Active.INACTIVE);
        if (that.pullTimer) {
          that.pullTimer.start();
        }
        return;
      }

      try {
        // NEW API FIELD MAPPING:
        // current_temp -> current temperature
        // temp -> target temperature
        // status -> on/off power state
        // heating -> on/off heating state

        var newCurrentTemperature = parseFloat(status.current_temp);
        var oldCurrentTemperature = that.service.getCharacteristic(Characteristic.CurrentTemperature).value;
        if (newCurrentTemperature != oldCurrentTemperature && newCurrentTemperature != undefined &&
            newCurrentTemperature >= that.minTemp && newCurrentTemperature <= that.maxTemp) {
          that.service.getCharacteristic(Characteristic.CurrentTemperature).updateValue(newCurrentTemperature);
          that.log.info("Changing CurrentTemperature from %s to %s", oldCurrentTemperature, newCurrentTemperature);
        }

        var newHeatingThresholdTemperature = parseFloat(status.temp);
        var oldHeatingThresholdTemperature = that.service.getCharacteristic(Characteristic.HeatingThresholdTemperature).value;
        if (newHeatingThresholdTemperature != oldHeatingThresholdTemperature && newHeatingThresholdTemperature != undefined &&
            newHeatingThresholdTemperature >= that.minTemp && newHeatingThresholdTemperature <= that.maxTemp) {
          that.service.getCharacteristic(Characteristic.HeatingThresholdTemperature).updateValue(newHeatingThresholdTemperature);
          that.log.info("Changing HeatingThresholdTemperature from %s to %s", oldHeatingThresholdTemperature, newHeatingThresholdTemperature);
        }

        var newHeaterActiveStatus = that.getTesyHeaterActiveState(status.status);
        var oldHeaterActiveStatus = that.service.getCharacteristic(Characteristic.Active).value;
        if (newHeaterActiveStatus != oldHeaterActiveStatus && newHeaterActiveStatus !== undefined) {
          that.service.getCharacteristic(Characteristic.Active).updateValue(newHeaterActiveStatus);
          that.log.info("Changing ActiveStatus from %s to %s", oldHeaterActiveStatus, newHeaterActiveStatus);
        }

        // heating field: "on" when actively heating, "off" when idle/ready
        var heatingState = status.heating === 'on' ? 'HEATING' : 'READY';
        var newCurrentHeaterCoolerState = that.getTesyHeaterCurrentHeaterCoolerState(heatingState);
        var oldCurrentHeaterCoolerState = that.service.getCharacteristic(Characteristic.CurrentHeaterCoolerState).value;
        if (newCurrentHeaterCoolerState != oldCurrentHeaterCoolerState) {
          that.service.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(newCurrentHeaterCoolerState);
          that.log.info("Changing CurrentHeaterCoolerState from %s to %s", oldCurrentHeaterCoolerState, newCurrentHeaterCoolerState);
        }

        if (that.pullTimer) {
          that.pullTimer.start();
        }
      } catch(e) {
        that.log.error("Error processing device status:", e);
        if (that.pullTimer) {
          that.pullTimer.start();
        }
        that.service.getCharacteristic(Characteristic.Active).updateValue(Characteristic.Active.INACTIVE);
      }
    });
  }

  getActive(callback) {
    if (this.pullTimer) {
      this.pullTimer.stop();
    }
    callback(null, this.service.getCharacteristic(Characteristic.Active).value);

    var that = this;

    this.fetchDeviceData(function(error, status) {
      if (error) {
        that.service.getCharacteristic(Characteristic.Active).updateValue(Characteristic.Active.INACTIVE);
        if (that.pullTimer) {
          that.pullTimer.start();
        }
        return;
      }

      var newHeaterActiveStatus = that.getTesyHeaterActiveState(status.status);
      var oldHeaterActiveStatus = that.service.getCharacteristic(Characteristic.Active).value;
      if (newHeaterActiveStatus != oldHeaterActiveStatus && newHeaterActiveStatus !== undefined) {
        that.service.getCharacteristic(Characteristic.Active).updateValue(newHeaterActiveStatus);
        that.log.info("Changing ActiveStatus from %s to %s", oldHeaterActiveStatus, newHeaterActiveStatus);
      }

      if (that.pullTimer) {
        that.pullTimer.start();
      }
    });
  }

  setActive(value, callback) {
    this.log.info("[+] Changing Active status to value: %s", value);

    if (this.pullTimer) {
      this.pullTimer.stop();
    }

    var that = this;

    let newValue = value === 0 ? 'off' : 'on';

    // Send MQTT command
    this.sendMQTTCommand('onOff', { status: newValue }, function(error) {
      if (error) {
        that.log.error("Error setting active status via MQTT:", error);
        callback(error);
      } else {
        that.log.info("✓ Active status changed to:", newValue);
        callback(null);
      }
      if (that.pullTimer) {
        that.pullTimer.start();
      }
    });
  }

  getCurrentTemperature(callback) {
    if (this.pullTimer) {
      this.pullTimer.stop();
    }

    callback(null, this.service.getCharacteristic(Characteristic.CurrentTemperature).value);

    var that = this;

    this.fetchDeviceData(function(error, status) {
      if (error) {
        that.service.getCharacteristic(Characteristic.Active).updateValue(Characteristic.Active.INACTIVE);
        if (that.pullTimer) {
          that.pullTimer.start();
        }
        return;
      }

      var newCurrentTemperature = parseFloat(status.current_temp);
      var oldCurrentTemperature = that.service.getCharacteristic(Characteristic.CurrentTemperature).value;
      if (newCurrentTemperature != oldCurrentTemperature && newCurrentTemperature != undefined &&
          newCurrentTemperature >= that.minTemp && newCurrentTemperature <= that.maxTemp) {
        that.service.getCharacteristic(Characteristic.CurrentTemperature).updateValue(newCurrentTemperature);
        that.log.info("Changing CurrentTemperature from %s to %s", oldCurrentTemperature, newCurrentTemperature);
      }

      if (that.pullTimer) {
        that.pullTimer.start();
      }
    });
  }

  getHeatingThresholdTemperature(callback) {
    if (this.pullTimer) {
      this.pullTimer.stop();
    }

    callback(null, this.service.getCharacteristic(Characteristic.HeatingThresholdTemperature).value);

    var that = this;

    this.fetchDeviceData(function(error, status) {
      if (error) {
        if (that.pullTimer) {
          that.pullTimer.start();
        }
        return;
      }

      var newHeatingThresholdTemperature = parseFloat(status.temp);
      var oldHeatingThresholdTemperature = that.service.getCharacteristic(Characteristic.HeatingThresholdTemperature).value;
      if (newHeatingThresholdTemperature != oldHeatingThresholdTemperature && newHeatingThresholdTemperature != undefined &&
          newHeatingThresholdTemperature >= that.minTemp && newHeatingThresholdTemperature <= that.maxTemp) {
        that.service.getCharacteristic(Characteristic.HeatingThresholdTemperature).updateValue(newHeatingThresholdTemperature);
        that.log.info("Changing HeatingThresholdTemperature from %s to %s", oldHeatingThresholdTemperature, newHeatingThresholdTemperature);
      }

      if (that.pullTimer) {
        that.pullTimer.start();
      }
    });
  }

  setHeatingThresholdTemperature(value, callback) {
    if (value < this.minTemp)
      value = this.minTemp;
    if (value > this.maxTemp)
      value = this.maxTemp;
    this.log.info("[+] Changing HeatingThresholdTemperature to value: %s", value);

    if (this.pullTimer) {
      this.pullTimer.stop();
    }

    var that = this;

    // First, set mode to "manual" to allow custom temperature
    this.sendMQTTCommand('setMode', { mode: 'manual' }, function(error) {
      if (error) {
        that.log.error("Error setting mode to manual via MQTT:", error);
        callback(error);
        if (that.pullTimer) {
          that.pullTimer.start();
        }
        return;
      }

      that.log.info("✓ Mode changed to manual");

      // Now set the temperature
      that.sendMQTTCommand('setTemp', { temp: value }, function(error) {
        if (error) {
          that.log.error("Error setting temperature via MQTT:", error);
          callback(error);
        } else {
          that.log.info("✓ Temperature changed to:", value);
          callback(null);
        }
        if (that.pullTimer) {
          that.pullTimer.start();
        }
      });
    });
  }

  getTargetHeaterCoolerState(callback) {
    callback(null, Characteristic.TargetHeaterCoolerState.HEAT);
  }

  getName(callback) {
    callback(null, this.name);
  }

  getServices() {
    this.informationService = new Service.AccessoryInformation();
    
    this.informationService
      .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(Characteristic.Model, this.model)
      .setCharacteristic(Characteristic.SerialNumber, this.device_id);

    this.service.getCharacteristic(Characteristic.Active)
      .on('get', this.getActive.bind(this))
      .on('set', this.setActive.bind(this))

    this.service.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
      .updateValue(Characteristic.CurrentHeaterCoolerState.INACTIVE);

    this.service
      .getCharacteristic(Characteristic.TargetHeaterCoolerState)
      .on('get', this.getTargetHeaterCoolerState.bind(this));

    this.service.getCharacteristic(Characteristic.CurrentTemperature)
      .on('get', this.getCurrentTemperature.bind(this));

    this.service.getCharacteristic(Characteristic.HeatingThresholdTemperature)
      .on('get', this.getHeatingThresholdTemperature.bind(this))
      .on('set', this.setHeatingThresholdTemperature.bind(this))

    this.service
      .getCharacteristic(Characteristic.Name)
      .on('get', this.getName.bind(this));

    this.service.getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({
        minStep: 0.1
      });

    this.service.getCharacteristic(Characteristic.HeatingThresholdTemperature)
      .setProps({
        minValue: this.minTemp,
        maxValue: this.maxTemp,
        minStep: 0.5
      })
      .updateValue(this.minTemp);

    //adding this characteristic so the marker for current temperature appears in the homekit wheel.
    this.service.getCharacteristic(Characteristic.CoolingThresholdTemperature)
      .setProps({
        minValue: this.minTemp,
        maxValue: this.maxTemp,
        minStep: 0.5
      })
      .updateValue(0);
 
    this.service.getCharacteristic(Characteristic.TargetHeaterCoolerState)
      .setProps({
        validValues: [Characteristic.TargetHeaterCoolerState.HEAT]
      });

    this.refreshTesyHeaterStatus();

    return [this.informationService, this.service];
  }
}