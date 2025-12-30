const mqtt = require('mqtt');

// Mock mqtt module
jest.mock('mqtt');

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
    if (platformInstance && platformInstance.pollingInterval) {
      clearInterval(platformInstance.pollingInterval);
      platformInstance.pollingInterval = null;
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
          reconnectPeriod: 5000,
          keepalive: 60,
          clean: true,
          connectTimeout: 30000
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
      expect(mockMqttClient.on).toHaveBeenCalledWith('reconnect', expect.any(Function));
      expect(mockMqttClient.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockMqttClient.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockMqttClient.on).toHaveBeenCalledWith('offline', expect.any(Function));
      expect(mockMqttClient.on).toHaveBeenCalledWith('end', expect.any(Function));
    });

    test('should reset reconnecting flag on successful connect', () => {
      platformInstance.initMQTT();
      platformInstance.mqttReconnecting = true;

      const connectHandler = mockMqttClient.on.mock.calls.find(call => call[0] === 'connect')[1];
      connectHandler();

      expect(platformInstance.mqttReconnecting).toBe(false);
    });

    test('should handle keepalive timeout error gracefully', () => {
      platformInstance.initMQTT();

      const errorHandler = mockMqttClient.on.mock.calls.find(call => call[0] === 'error')[1];
      const keepaliveError = new Error('Keepalive timeout');
      errorHandler(keepaliveError);

      expect(mockLog.warn).toHaveBeenCalledWith('MQTT keepalive timeout - reconnecting...');
    });

    test('should handle non-keepalive errors', () => {
      platformInstance.initMQTT();

      const errorHandler = mockMqttClient.on.mock.calls.find(call => call[0] === 'error')[1];
      const otherError = new Error('Connection failed');
      errorHandler(otherError);

      expect(mockLog.error).toHaveBeenCalledWith('MQTT Error:', 'Connection failed');
    });

    test('should set reconnecting flag on reconnect event', () => {
      platformInstance.initMQTT();
      platformInstance.mqttReconnecting = false;

      const reconnectHandler = mockMqttClient.on.mock.calls.find(call => call[0] === 'reconnect')[1];
      reconnectHandler();

      expect(platformInstance.mqttReconnecting).toBe(true);
      expect(mockLog.info).toHaveBeenCalledWith('Reconnecting to MQTT broker...');
    });

    test('should not spam logs on multiple reconnect attempts', () => {
      platformInstance.initMQTT();

      const reconnectHandler = mockMqttClient.on.mock.calls.find(call => call[0] === 'reconnect')[1];
      reconnectHandler();
      reconnectHandler();
      reconnectHandler();

      // Should only log once
      expect(mockLog.info.mock.calls.filter(call =>
        call[0] === 'Reconnecting to MQTT broker...'
      ).length).toBe(1);
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

    test('should queue command if MQTT not connected', (done) => {
      platformInstance.mqttClient.connected = false;
      platformInstance.mqttCommandQueue = [];

      platformInstance.sendMQTTCommand(mockDeviceInfo, 'onOff', { status: 'on' }, (error) => {
        expect(error).toBeNull(); // Optimistic response
        expect(platformInstance.mqttCommandQueue).toHaveLength(1);
        done();
      });
    });

    test('should queue command if MQTT client not initialized', (done) => {
      platformInstance.mqttClient = null;
      platformInstance.mqttCommandQueue = [];

      platformInstance.sendMQTTCommand(mockDeviceInfo, 'onOff', { status: 'on' }, (error) => {
        expect(error).toBeNull(); // Optimistic response
        expect(platformInstance.mqttCommandQueue).toHaveLength(1);
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

    test('should fallback to temperature comparison when heating field is missing', () => {
      // Device ON, heating field missing, current < target by 0.5°C or more → HEATING
      const status1 = { status: 'on', temp: 22, current_temp: 20 };
      expect(platformInstance._calculateHeatingState(status1)).toBe(Characteristic.CurrentHeaterCoolerState.HEATING);

      // Device ON, heating field missing, current < target by exactly 0.5°C → HEATING
      const status2 = { status: 'on', temp: 20, current_temp: 19.5 };
      expect(platformInstance._calculateHeatingState(status2)).toBe(Characteristic.CurrentHeaterCoolerState.HEATING);

      // Device ON, heating field missing, current >= target → IDLE
      const status3 = { status: 'on', temp: 20, current_temp: 20 };
      expect(platformInstance._calculateHeatingState(status3)).toBe(Characteristic.CurrentHeaterCoolerState.IDLE);

      // Device ON, heating field missing, current > target → IDLE
      const status4 = { status: 'on', temp: 20, current_temp: 20.5 };
      expect(platformInstance._calculateHeatingState(status4)).toBe(Characteristic.CurrentHeaterCoolerState.IDLE);

      // Device ON, heating field missing, current < target by less than 0.5°C → IDLE
      const status5 = { status: 'on', temp: 20, current_temp: 19.6 };
      expect(platformInstance._calculateHeatingState(status5)).toBe(Characteristic.CurrentHeaterCoolerState.IDLE);
    });

    test('should prefer heating field over temperature fallback when both exist', () => {
      // heating field says 'off', but temp difference suggests heating → trust heating field
      const status = { status: 'on', heating: 'off', temp: 22, current_temp: 20 };
      expect(platformInstance._calculateHeatingState(status)).toBe(Characteristic.CurrentHeaterCoolerState.IDLE);
    });
  });

  describe('MQTT Message Handler', () => {
    let mockAccessory;
    let mockService;
    let mockCurrentHeaterCoolerState;
    let mockCurrentTemperature;
    let mockHeatingThresholdTemperature;
    let messageHandler;

    beforeEach(() => {
      // Reset mocks
      jest.clearAllMocks();

      // Setup mock characteristics
      mockCurrentHeaterCoolerState = {
        value: 0,
        updateValue: jest.fn().mockReturnThis()
      };

      mockCurrentTemperature = {
        value: 20,
        updateValue: jest.fn().mockReturnThis()
      };

      mockHeatingThresholdTemperature = {
        value: 20,
        updateValue: jest.fn().mockReturnThis()
      };

      mockService = {
        getCharacteristic: jest.fn((type) => {
          if (type === Characteristic.CurrentHeaterCoolerState) return mockCurrentHeaterCoolerState;
          if (type === Characteristic.CurrentTemperature) return mockCurrentTemperature;
          if (type === Characteristic.HeatingThresholdTemperature) return mockHeatingThresholdTemperature;
          return { updateValue: jest.fn() };
        })
      };

      mockAccessory = new mockApi.platformAccessory('Test Heater', 'uuid-123456');
      mockAccessory.getService = jest.fn(() => mockService);

      // Setup device
      const deviceInfo = {
        id: '123456',
        mac: '1C:9D:C2:36:AA:08',
        token: 'testtoken',
        model: 'cn05uv',
        name: 'Test Heater'
      };

      platformInstance.devices['123456'] = {
        info: deviceInfo,
        accessory: mockAccessory
      };

      // Initialize MQTT (this registers the message handler)
      platformInstance.initMQTT();

      // Capture the message handler from mockMqttClient.on calls
      const onCalls = mockMqttClient.on.mock.calls;
      const messageCall = onCalls.find(call => call[0] === 'message');
      messageHandler = messageCall ? messageCall[1] : null;
    });

    test('should update CurrentTemperature from setTempStatistic message', () => {
      const topic = 'v1/1C:9D:C2:36:AA:08/response/cn05uv/testtoken/setTempStatistic';
      const message = JSON.stringify({
        payload: {
          currentTemp: 22.5,
          target: 20,
          heating: 'off'
        }
      });

      messageHandler(topic, Buffer.from(message));

      expect(mockCurrentTemperature.updateValue).toHaveBeenCalledWith(22.5);
    });

    test('should update HeatingThresholdTemperature from setTempStatistic message', () => {
      const topic = 'v1/1C:9D:C2:36:AA:08/response/cn05uv/testtoken/setTempStatistic';
      const message = JSON.stringify({
        payload: {
          currentTemp: 20,
          target: 23,
          heating: 'off'
        }
      });

      messageHandler(topic, Buffer.from(message));

      expect(mockHeatingThresholdTemperature.updateValue).toHaveBeenCalledWith(23);
    });

    test('should trigger heating state update when heating field changes', (done) => {
      const mockFetchDeviceStatus = jest.fn((_deviceInfo, callback) => {
        callback(null, {
          status: 'on',
          heating: 'on',
          temp: 20,
          current_temp: 18
        });
      });

      platformInstance.fetchDeviceStatus = mockFetchDeviceStatus;

      const topic = 'v1/1C:9D:C2:36:AA:08/response/cn05uv/testtoken/setTempStatistic';
      const message = JSON.stringify({
        payload: {
          currentTemp: 18,
          target: 20,
          heating: 'on'
        }
      });

      messageHandler(topic, Buffer.from(message));

      // Give async operation time to complete
      setImmediate(() => {
        expect(mockFetchDeviceStatus).toHaveBeenCalled();
        expect(mockCurrentHeaterCoolerState.updateValue).toHaveBeenCalledWith(
          Characteristic.CurrentHeaterCoolerState.HEATING
        );
        done();
      });
    });

    test('should ignore messages with invalid topic format', () => {
      const topic = 'v1/invalid';
      const message = JSON.stringify({
        payload: {
          currentTemp: 22,
          target: 20
        }
      });

      messageHandler(topic, Buffer.from(message));

      expect(mockCurrentTemperature.updateValue).not.toHaveBeenCalled();
    });

    test('should ignore non-setTempStatistic messages', () => {
      const topic = 'v1/1C:9D:C2:36:AA:08/response/cn05uv/testtoken/onOff';
      const message = JSON.stringify({
        payload: {
          status: 'on'
        }
      });

      messageHandler(topic, Buffer.from(message));

      expect(mockCurrentTemperature.updateValue).not.toHaveBeenCalled();
    });

    test('should ignore messages without payload', () => {
      const topic = 'v1/1C:9D:C2:36:AA:08/response/cn05uv/testtoken/setTempStatistic';
      const message = JSON.stringify({});

      messageHandler(topic, Buffer.from(message));

      expect(mockCurrentTemperature.updateValue).not.toHaveBeenCalled();
    });

    test('should ignore messages for unknown devices', () => {
      const topic = 'v1/AA:BB:CC:DD:EE:FF/response/cn05uv/testtoken/setTempStatistic';
      const message = JSON.stringify({
        payload: {
          currentTemp: 22,
          target: 20
        }
      });

      messageHandler(topic, Buffer.from(message));

      expect(mockCurrentTemperature.updateValue).not.toHaveBeenCalled();
    });

    test('should handle invalid JSON gracefully', () => {
      const topic = 'v1/1C:9D:C2:36:AA:08/response/cn05uv/testtoken/setTempStatistic';
      const message = 'invalid json';

      // Should not throw error
      expect(() => {
        messageHandler(topic, Buffer.from(message));
      }).not.toThrow();
    });

    test('should not update temperature if value unchanged', () => {
      mockCurrentTemperature.value = 22;

      const topic = 'v1/1C:9D:C2:36:AA:08/response/cn05uv/testtoken/setTempStatistic';
      const message = JSON.stringify({
        payload: {
          currentTemp: 22,
          target: 20,
          heating: 'off'
        }
      });

      messageHandler(topic, Buffer.from(message));

      expect(mockCurrentTemperature.updateValue).not.toHaveBeenCalled();
    });

    test('should respect temperature limits for target temperature', () => {
      const topic = 'v1/1C:9D:C2:36:AA:08/response/cn05uv/testtoken/setTempStatistic';
      const message = JSON.stringify({
        payload: {
          currentTemp: 20,
          target: 50, // Above maxTemp (30)
          heating: 'off'
        }
      });

      messageHandler(topic, Buffer.from(message));

      // Should not update because 50 > maxTemp
      expect(mockHeatingThresholdTemperature.updateValue).not.toHaveBeenCalled();
    });

    test('should ignore target temperature of 0', () => {
      const topic = 'v1/1C:9D:C2:36:AA:08/response/cn05uv/testtoken/setTempStatistic';
      const message = JSON.stringify({
        payload: {
          currentTemp: 20,
          target: 0,
          heating: 'off'
        }
      });

      messageHandler(topic, Buffer.from(message));

      expect(mockHeatingThresholdTemperature.updateValue).not.toHaveBeenCalled();
    });
  });

  describe('Error Recovery', () => {
    test('should track consecutive errors', (done) => {
      const https = require('https');
      let errorHandler;

      const mockRequest = {
        on: jest.fn((event, handler) => {
          if (event === 'error') {
            errorHandler = handler;
          }
          return mockRequest;
        }),
        setTimeout: jest.fn()
      };

      https.get = jest.fn(() => mockRequest);

      platformInstance._httpsGet('https://test.com', (error) => {
        expect(error).toBeDefined();
        expect(platformInstance.consecutiveErrors).toBe(1);
        done();
      });

      // Trigger error
      if (errorHandler) {
        errorHandler(new Error('ENOTFOUND'));
      }
    });

    test('should reset consecutive errors on successful request', (done) => {
      const https = require('https');
      platformInstance.consecutiveErrors = 5;

      const mockResponse = {
        on: jest.fn((event, handler) => {
          if (event === 'data') {
            handler('test data');
          } else if (event === 'end') {
            handler();
          }
          return mockResponse;
        })
      };

      const mockRequest = {
        on: jest.fn(() => mockRequest),
        setTimeout: jest.fn()
      };

      https.get = jest.fn((url, handler) => {
        handler(mockResponse);
        return mockRequest;
      });

      platformInstance._httpsGet('https://test.com', (error) => {
        expect(error).toBeNull();
        expect(platformInstance.consecutiveErrors).toBe(0);
        expect(mockLog.info).toHaveBeenCalledWith(
          expect.stringContaining('Connection restored after'),
          5
        );
        done();
      });
    });

    test('should throttle error logging', (done) => {
      const https = require('https');
      platformInstance.lastErrorLogTime = Date.now();

      const mockRequest = {
        on: jest.fn((event, handler) => {
          if (event === 'error') {
            handler(new Error('Test error'));
          }
          return mockRequest;
        }),
        setTimeout: jest.fn()
      };

      https.get = jest.fn(() => mockRequest);

      platformInstance._httpsGet('https://test.com', () => {
        expect(mockLog.error).not.toHaveBeenCalled();
        expect(mockLog.debug).toHaveBeenCalledWith(
          expect.stringContaining('throttled'),
          expect.any(Number)
        );
        done();
      });
    });

    test('should handle API timeout', (done) => {
      const https = require('https');
      let timeoutCallback;

      const mockRequest = {
        on: jest.fn(() => mockRequest),
        setTimeout: jest.fn((timeout, handler) => {
          timeoutCallback = handler;
        }),
        destroy: jest.fn()
      };

      https.get = jest.fn(() => mockRequest);

      platformInstance._httpsGet('https://test.com', (error) => {
        expect(error).toBeDefined();
        expect(error.message).toContain('timeout');
        expect(mockRequest.destroy).toHaveBeenCalled();
        expect(platformInstance.consecutiveErrors).toBeGreaterThan(0);
        done();
      });

      // Trigger timeout callback
      if (timeoutCallback) {
        timeoutCallback();
      }
    });

    test('should queue MQTT commands when offline', () => {
      mockMqttClient.connected = false;
      platformInstance.mqttClient = mockMqttClient;

      const deviceInfo = {
        id: '123',
        mac: '1C:9D:C2:36:AA:08',
        token: 'testtoken',
        model: 'cn05uv',
        name: 'Test Heater'
      };

      const callback = jest.fn();
      platformInstance.sendMQTTCommand(deviceInfo, 'onOff', { status: 'on' }, callback);

      expect(platformInstance.mqttCommandQueue).toHaveLength(1);
      expect(platformInstance.mqttCommandQueue[0]).toEqual({
        deviceInfo,
        command: 'onOff',
        payload: { status: 'on' },
        callback
      });
      expect(callback).toHaveBeenCalledWith(null); // Optimistic response
    });

    test('should process queued commands on reconnection', () => {
      // Queue some commands
      const deviceInfo = {
        id: '123',
        mac: '1C:9D:C2:36:AA:08',
        token: 'testtoken',
        model: 'cn05uv',
        name: 'Test Heater'
      };

      platformInstance.mqttCommandQueue = [
        {
          deviceInfo,
          command: 'onOff',
          payload: { status: 'on' },
          callback: jest.fn()
        },
        {
          deviceInfo,
          command: 'setTemp',
          payload: { temp: 25 },
          callback: jest.fn()
        }
      ];

      platformInstance.initMQTT();
      mockMqttClient.connected = true;
      platformInstance.mqttClient = mockMqttClient;

      const connectHandler = mockMqttClient.on.mock.calls.find(call => call[0] === 'connect')[1];
      connectHandler();

      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringContaining('Processing'),
        2
      );
      expect(platformInstance.mqttCommandQueue).toHaveLength(0);
      expect(mockMqttClient.publish).toHaveBeenCalledTimes(2);
    });

    test('should limit command queue to 10 items', () => {
      mockMqttClient.connected = false;
      platformInstance.mqttClient = mockMqttClient;

      const deviceInfo = {
        id: '123',
        mac: '1C:9D:C2:36:AA:08',
        token: 'testtoken',
        model: 'cn05uv',
        name: 'Test Heater'
      };

      // Fill queue to limit
      for (let i = 0; i < 10; i++) {
        platformInstance.sendMQTTCommand(deviceInfo, 'onOff', { status: 'on' }, jest.fn());
      }

      expect(platformInstance.mqttCommandQueue).toHaveLength(10);

      // Try to add one more
      const failCallback = jest.fn();
      platformInstance.sendMQTTCommand(deviceInfo, 'onOff', { status: 'on' }, failCallback);

      expect(platformInstance.mqttCommandQueue).toHaveLength(10); // Should not increase
      expect(mockLog.warn).toHaveBeenCalledWith('MQTT command queue full - dropping command');
      expect(failCallback).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('Device Discovery Rate Limiting', () => {
    test('should enforce minimum interval between discovery attempts', () => {
      platformInstance.lastDiscoveryAttempt = Date.now();

      platformInstance.discoverDevices();

      expect(mockLog.debug).toHaveBeenCalledWith(
        expect.stringContaining('Too soon for another discovery attempt'),
        expect.any(Number)
      );
    });

    test('should allow discovery after interval has passed', () => {
      platformInstance.lastDiscoveryAttempt = Date.now() - 11000; // 11 seconds ago

      const https = require('https');
      const mockResponse = {
        on: jest.fn((event, handler) => {
          if (event === 'data') {
            handler('{"testmac": {"state": {"id": 123}}}');
          } else if (event === 'end') {
            handler();
          }
          return mockResponse;
        })
      };

      const mockRequest = {
        on: jest.fn(() => mockRequest),
        setTimeout: jest.fn()
      };

      https.get = jest.fn((url, handler) => {
        handler(mockResponse);
        return mockRequest;
      });

      platformInstance.discoverDevices();

      expect(mockLog.info).toHaveBeenCalledWith('Fetching devices from Tesy Cloud...');
    });

    test('should skip discovery if already in progress', () => {
      platformInstance.isDiscovering = true;

      platformInstance.discoverDevices();

      expect(mockLog.debug).toHaveBeenCalledWith('Device discovery already in progress, skipping...');
    });
  });

  describe('MQTT Subscription on Device Add', () => {
    test('should subscribe to MQTT topic when device is added and MQTT is connected', () => {
      platformInstance.mqttClient = mockMqttClient;
      mockMqttClient.connected = true;

      const deviceInfo = {
        id: '123',
        mac: '1C:9D:C2:36:AA:08',
        token: 'testtoken',
        model: 'cn05uv',
        name: 'Test Heater',
        state: {
          id: 123,
          status: 'off',
          temp: 20,
          current_temp: 18
        }
      };

      platformInstance.addDevice(deviceInfo);

      expect(mockMqttClient.subscribe).toHaveBeenCalledWith(
        'v1/1C:9D:C2:36:AA:08/response/cn05uv/testtoken/#',
        expect.any(Function)
      );
    });

    test('should not subscribe if MQTT is not connected', () => {
      platformInstance.mqttClient = mockMqttClient;
      mockMqttClient.connected = false;

      const deviceInfo = {
        id: '124',
        mac: '1C:9D:C2:36:AA:09',
        token: 'testtoken2',
        model: 'cn05uv',
        name: 'Test Heater 2',
        state: {
          id: 124,
          status: 'off',
          temp: 20,
          current_temp: 18
        }
      };

      // Clear previous calls
      mockMqttClient.subscribe.mockClear();

      platformInstance.addDevice(deviceInfo);

      expect(mockMqttClient.subscribe).not.toHaveBeenCalled();
    });
  });

  describe('Polling Control', () => {
    afterEach(() => {
      // Clean up any intervals
      if (platformInstance.pollingInterval) {
        clearInterval(platformInstance.pollingInterval);
        platformInstance.pollingInterval = null;
      }
    });

    test('should not start multiple polling intervals', () => {
      // Use a mock interval instead of a real one
      const mockInterval = {};
      platformInstance.pollingInterval = mockInterval;

      platformInstance.startPolling();

      expect(mockLog.debug).toHaveBeenCalledWith('Polling already active, skipping start');
      expect(platformInstance.pollingInterval).toBe(mockInterval); // Should not change
    });

    test('should trigger discovery when updateAllDevices has no devices', () => {
      platformInstance.devices = {};
      platformInstance.isDiscovering = false;
      platformInstance.lastDiscoveryAttempt = 0;

      const discoverSpy = jest.spyOn(platformInstance, 'discoverDevices');

      platformInstance.updateAllDevices();

      expect(discoverSpy).toHaveBeenCalled();

      discoverSpy.mockRestore();
    });
  });
});
