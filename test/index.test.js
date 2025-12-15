const mqtt = require('mqtt');

// Mock mqtt module
jest.mock('mqtt');

// Mock homebridge-http-base
jest.mock('homebridge-http-base', () => ({
  HttpAccessory: class MockHttpAccessory {
    constructor() {
      this.log = {
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
      };
    }
  },
  PullTimer: class MockPullTimer {
    constructor(log, interval, callback) {
      this.callback = callback;
    }
    start() {}
    stop() {}
  }
}));

// Mock homebridge API
const mockHomebridge = {
  hap: {
    Service: {
      HeaterCooler: function() {
        this.getCharacteristic = jest.fn(() => ({
          on: jest.fn(() => ({
            on: jest.fn(() => this)
          })),
          value: 20,
          updateValue: jest.fn()
        }));
        this.setCharacteristic = jest.fn(() => this);
      }
    },
    Characteristic: {
      Active: { INACTIVE: 0, ACTIVE: 1 },
      CurrentHeaterCoolerState: { INACTIVE: 0, IDLE: 1, HEATING: 2 },
      TargetHeaterCoolerState: { AUTO: 0, HEAT: 1, COOL: 2 },
      CurrentTemperature: {},
      HeatingThresholdTemperature: {},
      TemperatureDisplayUnits: { CELSIUS: 0 }
    }
  },
  registerAccessory: jest.fn()
};

describe('TesyHeater Plugin', () => {
  let TesyHeater;
  let mockMqttClient;
  let heaterInstance;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup mock MQTT client
    mockMqttClient = {
      connect: jest.fn(),
      on: jest.fn(),
      subscribe: jest.fn(),
      publish: jest.fn(),
      connected: true
    };

    mqtt.connect.mockReturnValue(mockMqttClient);

    // Load the module
    delete require.cache[require.resolve('../index.js')];
    TesyHeater = require('../index.js')(mockHomebridge);

    // Create instance
    heaterInstance = new TesyHeater(
      {
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
      },
      {
        name: 'Test Heater',
        userid: '27356',
        username: 'test@example.com',
        password: 'testpass',
        device_id: '123456',
        maxTemp: 30,
        minTemp: 10,
        pullInterval: 60000
      }
    );

    // Setup device info for MQTT
    heaterInstance.device_mac = 'AA:BB:CC:DD:EE:FF';
    heaterInstance.device_token = 'abc1234';
    heaterInstance.device_model = 'cn05uv';
    heaterInstance.mqttClient = mockMqttClient;
  });

  describe('MQTT Initialization', () => {
    test('should connect to MQTT broker with correct credentials', () => {
      heaterInstance.initMQTT();

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

    test('should subscribe to response topics on connect', () => {
      const connectHandler = mockMqttClient.on.mock.calls.find(
        call => call[0] === 'connect'
      );

      if (connectHandler) {
        const subscribeCallback = jest.fn();
        mockMqttClient.subscribe.mockImplementation((topic, callback) => {
          callback(null);
        });

        heaterInstance.initMQTT();

        // Trigger connect event
        connectHandler[1]();

        expect(mockMqttClient.subscribe).toHaveBeenCalledWith(
          expect.stringContaining('v1/AA:BB:CC:DD:EE:FF/response/cn05uv/abc1234'),
          expect.any(Function)
        );
      }
    });
  });

  describe('sendMQTTCommand', () => {
    test('should publish command to correct MQTT topic', (done) => {
      mockMqttClient.publish.mockImplementation((topic, message, callback) => {
        callback(null);
      });

      heaterInstance.sendMQTTCommand('onOff', { status: 'on' }, (error) => {
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
        expect(payload.app_id).toMatch(/^hb[a-f0-9]{7}$/);
        callback(null);
      });

      heaterInstance.sendMQTTCommand('setTemp', { temp: 20 }, (error) => {
        expect(error).toBeNull();
        done();
      });
    });

    test('should return error if MQTT not connected', (done) => {
      heaterInstance.mqttClient.connected = false;

      heaterInstance.sendMQTTCommand('onOff', { status: 'on' }, (error) => {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('MQTT not connected');
        done();
      });
    });

    test('should return error if device info not available', (done) => {
      heaterInstance.device_mac = null;

      heaterInstance.sendMQTTCommand('onOff', { status: 'on' }, (error) => {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('Device info not available');
        done();
      });
    });
  });

  describe('setActive', () => {
    test('should send "on" command when value is 1', (done) => {
      mockMqttClient.publish.mockImplementation((topic, message, callback) => {
        const payload = JSON.parse(message);
        expect(payload.status).toBe('on');
        callback(null);
      });

      heaterInstance.setActive(1, (error) => {
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

      heaterInstance.setActive(0, (error) => {
        expect(error).toBeNull();
        done();
      });
    });
  });

  describe('setHeatingThresholdTemperature', () => {
    test('should set mode to manual before setting temperature', (done) => {
      const publishCalls = [];

      mockMqttClient.publish.mockImplementation((topic, message, callback) => {
        publishCalls.push({ topic, message: JSON.parse(message) });
        callback(null);
      });

      heaterInstance.setHeatingThresholdTemperature(20, (error) => {
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

      heaterInstance.setHeatingThresholdTemperature(5, (error) => {
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

      heaterInstance.setHeatingThresholdTemperature(35, (error) => {
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

      heaterInstance.setHeatingThresholdTemperature(20, (error) => {
        expect(error).toBeInstanceOf(Error);
        expect(mockMqttClient.publish).toHaveBeenCalledTimes(1); // Only setMode, no setTemp
        done();
      });
    });
  });

  describe('Configuration Validation', () => {
    test('should have correct MQTT broker URL', () => {
      heaterInstance.initMQTT();
      expect(mqtt.connect).toHaveBeenCalledWith(
        'wss://mqtt.tesy.com:8083/mqtt',
        expect.any(Object)
      );
    });

    test('should generate unique app_id', () => {
      const appId = heaterInstance.app_id;
      expect(appId).toMatch(/^hb[a-f0-9]{7}$/);

      const anotherInstance = new TesyHeater(
        {
          info: jest.fn(),
          error: jest.fn(),
          debug: jest.fn()
        },
        {
          name: 'Test Heater 2',
          userid: '27356',
          username: 'test@example.com',
          password: 'testpass',
          device_id: '123456',
          maxTemp: 30,
          minTemp: 10,
          pullInterval: 60000
        }
      );

      expect(anotherInstance.app_id).not.toBe(appId);
    });

    test('should respect temperature limits from config', () => {
      expect(heaterInstance.minTemp).toBe(10);
      expect(heaterInstance.maxTemp).toBe(30);
    });
  });
});
