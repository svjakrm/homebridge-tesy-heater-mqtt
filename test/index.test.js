const mqtt = require('mqtt');

// Mock mqtt module
jest.mock('mqtt');

// Mock http request
jest.mock('request', () => {
  return jest.fn();
});

describe('TesyHeater Platform Plugin', () => {
  let TesyHeaterPlatform;
  let mockLog;
  let mockConfig;
  let mockApi;
  let mockMqttClient;
  let platformInstance;
  let Service, Characteristic;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock logger
    mockLog = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn()
    };

    // Mock Homebridge API
    Service = {
      AccessoryInformation: function() {
        this.setCharacteristic = jest.fn(() => this);
        this.getCharacteristic = jest.fn(() => {
          const characteristic = {
            on: jest.fn(() => characteristic),
            setProps: jest.fn(() => characteristic),
            updateValue: jest.fn(() => characteristic)
          };
          return characteristic;
        });
      },
      HeaterCooler: function() {
        this.setCharacteristic = jest.fn(() => this);
        this.getCharacteristic = jest.fn(() => {
          const characteristic = {
            on: jest.fn(() => characteristic),
            setProps: jest.fn(() => characteristic),
            updateValue: jest.fn(() => characteristic)
          };
          return characteristic;
        });
        this.displayName = 'Test Heater';
      }
    };

    Characteristic = {
      Manufacturer: 'Manufacturer',
      Model: 'Model',
      SerialNumber: 'SerialNumber',
      Name: 'Name',
      Active: { INACTIVE: 0, ACTIVE: 1 },
      CurrentHeaterCoolerState: { INACTIVE: 0, IDLE: 1, HEATING: 2 },
      TargetHeaterCoolerState: { AUTO: 0, HEAT: 1, COOL: 2 },
      CurrentTemperature: 'CurrentTemperature',
      HeatingThresholdTemperature: 'HeatingThresholdTemperature',
      CoolingThresholdTemperature: 'CoolingThresholdTemperature',
      TemperatureDisplayUnits: { CELSIUS: 0 }
    };

    mockApi = {
      hap: {
        Service: Service,
        Characteristic: Characteristic,
        uuid: {
          generate: jest.fn((id) => `uuid-${id}`)
        }
      },
      platformAccessory: jest.fn(function(name, uuid) {
        this.displayName = name;
        this.UUID = uuid;
        this.context = {};
        this._associatedHAPAccessory = { displayName: name };
        this.getService = jest.fn((serviceType) => {
          if (serviceType === Service.AccessoryInformation || serviceType === Service.HeaterCooler) {
            return new serviceType();
          }
          return null;
        });
        this.addService = jest.fn((serviceType) => new serviceType());
        return this;
      }),
      updatePlatformAccessories: jest.fn(),
      registerPlatformAccessories: jest.fn(),
      unregisterPlatformAccessories: jest.fn(),
      registerPlatform: jest.fn(),
      on: jest.fn()
    };

    // Mock config
    mockConfig = {
      name: 'TesyHeater',
      userid: '27356',
      username: 'test@example.com',
      password: 'testpass',
      maxTemp: 30,
      minTemp: 10,
      pullInterval: 60000
    };

    // Setup mock MQTT client
    mockMqttClient = {
      on: jest.fn(),
      subscribe: jest.fn(),
      publish: jest.fn(),
      connected: true,
      end: jest.fn()
    };

    mqtt.connect = jest.fn(() => mockMqttClient);

    // Load the module by calling it with homebridge mock
    delete require.cache[require.resolve('../index.js')];
    const moduleExport = require('../index.js');

    // Initialize the plugin (this sets up global Service and Characteristic)
    moduleExport(mockApi);

    TesyHeaterPlatform = require('../index.js').TesyHeaterPlatform;

    // Create platform instance
    platformInstance = new TesyHeaterPlatform(mockLog, mockConfig, mockApi);
  });

  afterEach(() => {
    if (platformInstance && platformInstance.pullTimer) {
      platformInstance.pullTimer = null;
    }
    if (platformInstance && platformInstance.mqttClient) {
      platformInstance.mqttClient = null;
    }
  });

  describe('Platform Initialization', () => {
    test('should initialize with correct configuration', () => {
      expect(platformInstance.log).toBe(mockLog);
      expect(platformInstance.config).toBe(mockConfig);
      expect(platformInstance.api).toBe(mockApi);
      expect(platformInstance.accessories).toEqual([]);
      expect(platformInstance.devices).toEqual({});
    });

    test('should set temperature limits from config', () => {
      expect(platformInstance.minTemp).toBe(10);
      expect(platformInstance.maxTemp).toBe(30);
    });

    test('should set default temperature limits if not in config', () => {
      const configWithoutLimits = { ...mockConfig };
      delete configWithoutLimits.minTemp;
      delete configWithoutLimits.maxTemp;

      const instance = new TesyHeaterPlatform(mockLog, configWithoutLimits, mockApi);
      expect(instance.minTemp).toBe(10);
      expect(instance.maxTemp).toBe(30);
    });

    test('should use default pullInterval if not specified', () => {
      const configWithoutInterval = { ...mockConfig };
      delete configWithoutInterval.pullInterval;

      const instance = new TesyHeaterPlatform(mockLog, configWithoutInterval, mockApi);
      expect(instance.pullInterval).toBe(60000);
    });
  });

  describe('configureAccessory', () => {
    test('should restore cached accessory', () => {
      const mockAccessory = {
        UUID: 'uuid-123',
        displayName: 'Cached Heater',
        context: {}
      };

      platformInstance.configureAccessory(mockAccessory);

      expect(platformInstance.accessories).toContain(mockAccessory);
      expect(mockLog.info).toHaveBeenCalledWith('Configuring cached accessory:', 'Cached Heater');
    });
  });

  describe('MQTT Initialization', () => {
    test('should connect to MQTT broker with correct credentials', () => {
      platformInstance.initMQTT();

      expect(mqtt.connect).toHaveBeenCalledWith(
        'wss://mqtt.tesy.com:8083/mqtt',
        expect.objectContaining({
          username: 'client1',
          password: '123',
          protocol: 'wss',
          reconnectPeriod: 5000
        })
      );
    });

    test('should not initialize MQTT twice', () => {
      platformInstance.initMQTT();
      platformInstance.initMQTT();

      expect(mqtt.connect).toHaveBeenCalledTimes(1);
    });

    test('should set up event handlers on connect', () => {
      platformInstance.initMQTT();

      expect(mockMqttClient.on).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockMqttClient.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockMqttClient.on).toHaveBeenCalledWith('close', expect.any(Function));
    });
  });

  describe('sendMQTTCommand', () => {
    const mockDeviceInfo = {
      id: '123456',
      mac: 'AA:BB:CC:DD:EE:FF',
      token: 'abc1234',
      model: 'cn05uv',
      name: 'Test Heater'
    };

    beforeEach(() => {
      platformInstance.mqttClient = mockMqttClient;
    });

    test('should publish command to correct MQTT topic', (done) => {
      mockMqttClient.publish.mockImplementation((topic, message, callback) => {
        callback(null);
      });

      platformInstance.sendMQTTCommand(mockDeviceInfo, 'onOff', { status: 'on' }, (error) => {
        expect(error).toBeNull();
        expect(mockMqttClient.publish).toHaveBeenCalledWith(
          'v1/AA:BB:CC:DD:EE:FF/request/cn05uv/abc1234/onOff',
          expect.stringContaining('"status":"on"'),
          expect.any(Function)
        );
        done();
      });
    });

    test('should include app_id in message payload', (done) => {
      mockMqttClient.publish.mockImplementation((topic, message, callback) => {
        const payload = JSON.parse(message);
        expect(payload).toHaveProperty('app_id');
        expect(payload.app_id).toMatch(/^hb[a-f0-9]{7,8}$/);
        callback(null);
      });

      platformInstance.sendMQTTCommand(mockDeviceInfo, 'setTemp', { temp: 20 }, (error) => {
        expect(error).toBeNull();
        done();
      });
    });

    test('should return error if MQTT not connected', (done) => {
      platformInstance.mqttClient.connected = false;

      platformInstance.sendMQTTCommand(mockDeviceInfo, 'onOff', { status: 'on' }, (error) => {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('MQTT not connected');
        done();
      });
    });

    test('should return error if MQTT client not initialized', (done) => {
      platformInstance.mqttClient = null;

      platformInstance.sendMQTTCommand(mockDeviceInfo, 'onOff', { status: 'on' }, (error) => {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('MQTT not connected');
        done();
      });
    });
  });

  describe('setActive', () => {
    const mockDeviceInfo = {
      id: '123456',
      mac: 'AA:BB:CC:DD:EE:FF',
      token: 'abc1234',
      model: 'cn05uv',
      name: 'Test Heater'
    };

    beforeEach(() => {
      platformInstance.mqttClient = mockMqttClient;
    });

    test('should send "on" command when value is 1', (done) => {
      mockMqttClient.publish.mockImplementation((topic, message, callback) => {
        const payload = JSON.parse(message);
        expect(payload.status).toBe('on');
        callback(null);
      });

      platformInstance.setActive(mockDeviceInfo, 1, (error) => {
        expect(error).toBeNull();
        expect(mockMqttClient.publish).toHaveBeenCalledWith(
          expect.stringContaining('/onOff'),
          expect.any(String),
          expect.any(Function)
        );
        done();
      });
    });

    test('should send "off" command when value is 0', (done) => {
      mockMqttClient.publish.mockImplementation((topic, message, callback) => {
        const payload = JSON.parse(message);
        expect(payload.status).toBe('off');
        callback(null);
      });

      platformInstance.setActive(mockDeviceInfo, 0, (error) => {
        expect(error).toBeNull();
        done();
      });
    });
  });

  describe('setHeatingThresholdTemperature', () => {
    const mockDeviceInfo = {
      id: '123456',
      mac: 'AA:BB:CC:DD:EE:FF',
      token: 'abc1234',
      model: 'cn05uv',
      name: 'Test Heater'
    };

    beforeEach(() => {
      platformInstance.mqttClient = mockMqttClient;
    });

    test('should set mode to manual before setting temperature', (done) => {
      const publishCalls = [];

      mockMqttClient.publish.mockImplementation((topic, message, callback) => {
        publishCalls.push({ topic, message: JSON.parse(message) });
        callback(null);
      });

      platformInstance.setHeatingThresholdTemperature(mockDeviceInfo, 20, (error) => {
        expect(error).toBeNull();
        expect(publishCalls.length).toBe(2);

        // First call should be setMode to manual
        expect(publishCalls[0].topic).toContain('/setMode');
        expect(publishCalls[0].message.mode).toBe('manual');

        // Second call should be setTemp
        expect(publishCalls[1].topic).toContain('/setTemp');
        expect(publishCalls[1].message.temp).toBe(20);

        done();
      });
    });

    test('should clamp temperature to minTemp', (done) => {
      mockMqttClient.publish.mockImplementation((topic, message, callback) => {
        const payload = JSON.parse(message);
        if (topic.includes('/setTemp')) {
          expect(payload.temp).toBe(10); // minTemp
        }
        callback(null);
      });

      platformInstance.setHeatingThresholdTemperature(mockDeviceInfo, 5, (error) => {
        expect(error).toBeNull();
        done();
      });
    });

    test('should clamp temperature to maxTemp', (done) => {
      mockMqttClient.publish.mockImplementation((topic, message, callback) => {
        const payload = JSON.parse(message);
        if (topic.includes('/setTemp')) {
          expect(payload.temp).toBe(30); // maxTemp
        }
        callback(null);
      });

      platformInstance.setHeatingThresholdTemperature(mockDeviceInfo, 35, (error) => {
        expect(error).toBeNull();
        done();
      });
    });

    test('should handle setMode error and not proceed to setTemp', (done) => {
      mockMqttClient.publish.mockImplementation((topic, message, callback) => {
        if (topic.includes('/setMode')) {
          callback(new Error('MQTT error'));
        }
      });

      platformInstance.setHeatingThresholdTemperature(mockDeviceInfo, 20, (error) => {
        expect(error).toBeInstanceOf(Error);
        expect(mockMqttClient.publish).toHaveBeenCalledTimes(1); // Only setMode, no setTemp
        done();
      });
    });
  });

  describe('Device Management', () => {
    test('should add new device', () => {
      const deviceInfo = {
        id: '123456',
        mac: 'AA:BB:CC:DD:EE:FF',
        token: 'abc1234',
        model: 'cn05uv',
        name: 'Test Heater',
        state: { temp: 20 }
      };

      platformInstance.addDevice(deviceInfo);

      expect(platformInstance.devices['123456']).toBeDefined();
      expect(mockApi.registerPlatformAccessories).toHaveBeenCalled();
    });

    test('should restore existing device', () => {
      const deviceInfo = {
        id: '123456',
        mac: 'AA:BB:CC:DD:EE:FF',
        token: 'abc1234',
        model: 'cn05uv',
        name: 'Test Heater',
        state: { temp: 20 }
      };

      // Add a cached accessory
      const cachedAccessory = new mockApi.platformAccessory('Old Name', 'uuid-tesy-123456');
      cachedAccessory.context.deviceInfo = { ...deviceInfo, name: 'Old Name' };
      platformInstance.accessories.push(cachedAccessory);

      platformInstance.addDevice(deviceInfo);

      expect(platformInstance.devices['123456']).toBeDefined();
      expect(mockApi.updatePlatformAccessories).toHaveBeenCalled();
      expect(mockApi.registerPlatformAccessories).not.toHaveBeenCalled();
    });
  });

  describe('Configuration Validation', () => {
    test('should have correct MQTT broker URL', () => {
      platformInstance.initMQTT();
      expect(mqtt.connect).toHaveBeenCalledWith(
        'wss://mqtt.tesy.com:8083/mqtt',
        expect.any(Object)
      );
    });

    test('should respect temperature limits from config', () => {
      expect(platformInstance.minTemp).toBe(10);
      expect(platformInstance.maxTemp).toBe(30);
    });
  });

  describe('CurrentHeaterCoolerState Logic', () => {
    let mockAccessory;
    let mockService;
    let mockCurrentHeaterCoolerState;
    let mockCurrentTemperature;
    let mockHeatingThresholdTemperature;
    let mockActive;

    beforeEach(() => {
      // Setup device and accessory
      const deviceInfo = {
        id: '123456',
        mac: 'AA:BB:CC:DD:EE:FF',
        token: 'abc1234',
        model: 'cn05uv',
        name: 'Test Heater',
        state: { temp: 20, status: 'on', heating: 'off', current_temp: 20 }
      };

      // Create separate mock characteristics
      mockCurrentHeaterCoolerState = {
        on: jest.fn().mockReturnThis(),
        setProps: jest.fn().mockReturnThis(),
        updateValue: jest.fn().mockReturnThis(),
        value: 0 // Default to INACTIVE
      };

      mockCurrentTemperature = {
        on: jest.fn().mockReturnThis(),
        setProps: jest.fn().mockReturnThis(),
        updateValue: jest.fn().mockReturnThis(),
        value: 20
      };

      mockHeatingThresholdTemperature = {
        on: jest.fn().mockReturnThis(),
        setProps: jest.fn().mockReturnThis(),
        updateValue: jest.fn().mockReturnThis(),
        value: 20
      };

      mockActive = {
        on: jest.fn().mockReturnThis(),
        setProps: jest.fn().mockReturnThis(),
        updateValue: jest.fn().mockReturnThis(),
        value: 0
      };

      mockService = {
        getCharacteristic: jest.fn((type) => {
          if (type === Characteristic.CurrentHeaterCoolerState) return mockCurrentHeaterCoolerState;
          if (type === Characteristic.CurrentTemperature) return mockCurrentTemperature;
          if (type === Characteristic.HeatingThresholdTemperature) return mockHeatingThresholdTemperature;
          if (type === Characteristic.Active) return mockActive;
          return mockCurrentHeaterCoolerState;
        }),
        setCharacteristic: jest.fn().mockReturnThis()
      };

      mockAccessory = new mockApi.platformAccessory('Test Heater', 'uuid-test-123456');
      mockAccessory.getService = jest.fn(() => mockService);
      mockAccessory.context = { deviceInfo };

      platformInstance.devices['123456'] = {
        info: deviceInfo,
        accessory: mockAccessory
      };
    });

    test('should set INACTIVE state when device is OFF', () => {
      // Set initial state to IDLE (so change will trigger)
      mockCurrentHeaterCoolerState.value = Characteristic.CurrentHeaterCoolerState.IDLE;

      const status = {
        status: 'off',
        heating: 'off',
        temp: 20,
        current_temp: 20
      };

      platformInstance.updateAccessoryStatus(mockAccessory, status);

      expect(mockCurrentHeaterCoolerState.updateValue).toHaveBeenCalledWith(Characteristic.CurrentHeaterCoolerState.INACTIVE);
    });

    test('should set IDLE state when device is ON but not heating', () => {
      const status = {
        status: 'on',
        heating: 'off',
        temp: 20,
        current_temp: 20.5
      };

      platformInstance.updateAccessoryStatus(mockAccessory, status);

      expect(mockCurrentHeaterCoolerState.updateValue).toHaveBeenCalledWith(Characteristic.CurrentHeaterCoolerState.IDLE);
    });

    test('should set HEATING state when device is ON and heating', () => {
      const status = {
        status: 'on',
        heating: 'on',
        temp: 22,
        current_temp: 20
      };

      platformInstance.updateAccessoryStatus(mockAccessory, status);

      expect(mockCurrentHeaterCoolerState.updateValue).toHaveBeenCalledWith(Characteristic.CurrentHeaterCoolerState.HEATING);
    });

    test('should not update state if value has not changed', () => {
      const status = {
        status: 'off',
        heating: 'off',
        temp: 20,
        current_temp: 20
      };

      // Set current value to INACTIVE
      mockCurrentHeaterCoolerState.value = Characteristic.CurrentHeaterCoolerState.INACTIVE;

      platformInstance.updateAccessoryStatus(mockAccessory, status);

      // updateValue should not be called since value hasn't changed
      expect(mockCurrentHeaterCoolerState.updateValue).not.toHaveBeenCalled();
    });

    test('should handle uppercase status values', () => {
      const status = {
        status: 'ON',
        heating: 'on',
        temp: 22,
        current_temp: 20
      };

      platformInstance.updateAccessoryStatus(mockAccessory, status);

      expect(mockCurrentHeaterCoolerState.updateValue).toHaveBeenCalledWith(Characteristic.CurrentHeaterCoolerState.HEATING);
    });
  });

  describe('CurrentHeaterCoolerState GET Handler', () => {
    const mockDeviceInfo = {
      id: '123456',
      mac: 'AA:BB:CC:DD:EE:FF',
      token: 'abc1234',
      model: 'cn05uv',
      name: 'Test Heater'
    };

    beforeEach(() => {
      platformInstance.mqttClient = {
        connected: true,
        publish: jest.fn((topic, message, callback) => callback(null))
      };
    });

    test('should return INACTIVE when device is OFF', (done) => {
      // Mock fetchDeviceStatus to return device OFF
      platformInstance.fetchDeviceStatus = jest.fn((deviceInfo, callback) => {
        callback(null, {
          status: 'off',
          heating: 'off',
          temp: 20,
          current_temp: 20
        });
      });

      platformInstance.getCurrentHeaterCoolerState(mockDeviceInfo, (error, state) => {
        expect(error).toBeNull();
        expect(state).toBe(Characteristic.CurrentHeaterCoolerState.INACTIVE);
        done();
      });
    });

    test('should return IDLE when device is ON but not heating', (done) => {
      platformInstance.fetchDeviceStatus = jest.fn((deviceInfo, callback) => {
        callback(null, {
          status: 'on',
          heating: 'off',
          temp: 20,
          current_temp: 20.5
        });
      });

      platformInstance.getCurrentHeaterCoolerState(mockDeviceInfo, (error, state) => {
        expect(error).toBeNull();
        expect(state).toBe(Characteristic.CurrentHeaterCoolerState.IDLE);
        done();
      });
    });

    test('should return HEATING when device is ON and heating', (done) => {
      platformInstance.fetchDeviceStatus = jest.fn((deviceInfo, callback) => {
        callback(null, {
          status: 'on',
          heating: 'on',
          temp: 22,
          current_temp: 20
        });
      });

      platformInstance.getCurrentHeaterCoolerState(mockDeviceInfo, (error, state) => {
        expect(error).toBeNull();
        expect(state).toBe(Characteristic.CurrentHeaterCoolerState.HEATING);
        done();
      });
    });

    test('should handle fetch error', (done) => {
      platformInstance.fetchDeviceStatus = jest.fn((deviceInfo, callback) => {
        callback(new Error('API error'), null);
      });

      platformInstance.getCurrentHeaterCoolerState(mockDeviceInfo, (error, state) => {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('API error');
        expect(state).toBeUndefined();
        done();
      });
    });
  });

  describe('_calculateHeatingState Helper', () => {
    test('should return INACTIVE when device is OFF', () => {
      const status = { status: 'off', heating: 'off' };
      const state = platformInstance._calculateHeatingState(status);
      expect(state).toBe(Characteristic.CurrentHeaterCoolerState.INACTIVE);
    });

    test('should return IDLE when device is ON but not heating', () => {
      const status = { status: 'on', heating: 'off' };
      const state = platformInstance._calculateHeatingState(status);
      expect(state).toBe(Characteristic.CurrentHeaterCoolerState.IDLE);
    });

    test('should return HEATING when device is ON and heating', () => {
      const status = { status: 'on', heating: 'on' };
      const state = platformInstance._calculateHeatingState(status);
      expect(state).toBe(Characteristic.CurrentHeaterCoolerState.HEATING);
    });

    test('should handle uppercase status values', () => {
      const status = { status: 'ON', heating: 'on' };
      const state = platformInstance._calculateHeatingState(status);
      expect(state).toBe(Characteristic.CurrentHeaterCoolerState.HEATING);
    });

    test('should handle mixed case status values', () => {
      const status1 = { status: 'On', heating: 'off' };
      expect(platformInstance._calculateHeatingState(status1)).toBe(Characteristic.CurrentHeaterCoolerState.IDLE);

      const status2 = { status: 'OFF', heating: 'off' };
      expect(platformInstance._calculateHeatingState(status2)).toBe(Characteristic.CurrentHeaterCoolerState.INACTIVE);
    });
  });
});
