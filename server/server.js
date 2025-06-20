const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const ADBManager = require('./adb-manager');
const ScrcpyLauncher = require('./scrcpy-launcher');
const ControlHandler = require('./control-handler');
const VideoStreamer = require('./video-streamer');

const app = express();
const PORT = process.env.PORT || 3000;
const WS_PORT = 666;

// 创建实例
const adbManager = new ADBManager();
const scrcpyLauncher = new ScrcpyLauncher();
const videoStreamer = new VideoStreamer();
const controlHandler = new ControlHandler();

// 设备状态存储
const devices = new Map();

// 创建WebSocket服务器
const wss = new WebSocket.Server({ 
  port: WS_PORT,
  perMessageDeflate: false
});

console.log(`WebSocket server starting on port ${WS_PORT}`);

// WebSocket连接处理
wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress;
  console.log(`Client connected from ${clientIP}`);
  
  // 发送当前设备列表
  sendDeviceList(ws);
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`Received message from ${clientIP}:`, data);
      
      switch (data.action) {
        case 'LIST_DEVICES':
          await sendDeviceList(ws);
          break;
        case 'START_DEVICE':
          await startDevice(data.deviceId, ws);
          break;
        case 'STOP_DEVICE':
          stopDevice(data.deviceId);
          break;
        case 'CONTROL_DEVICE':
          controlDevice(data.deviceId, data.command, data.args);
          break;
        default:
          console.warn('Unknown action:', data.action);
          ws.send(JSON.stringify({
            type: 'ERROR',
            message: `Unknown action: ${data.action}`
          }));
      }
    } catch (error) {
      console.error('Error handling message:', error);
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Failed to process message: ' + error.message
      }));
    }
  });
  
  ws.on('close', () => {
    console.log(`Client disconnected from ${clientIP}`);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for client ${clientIP}:`, error);
  });
});

// 发送设备列表
async function sendDeviceList(ws) {
  try {
    console.log('Fetching device list...');
    const deviceIds = await adbManager.listDevices();
    console.log('Device IDs:', deviceIds);

    if (deviceIds.length === 0) {
      ws.send(JSON.stringify({
        type: 'DEVICE_LIST',
        devices: []
      }));
      return;
    }

    // 获取每个设备的详细信息
    const deviceDetailsPromises = deviceIds.map(device => 
      adbManager.getDeviceInfo(device.serial).catch(error => {
        console.error(`Error getting info for device ${device.serial}:`, error);
        return {
          id: device.serial,
          model: 'Unknown Device',
          version: 'Unknown',
          resolution: 'Unknown',
          serial: device.serial,
          state: 'device'
        };
      })
    );

    const deviceDetails = await Promise.all(deviceDetailsPromises);
    console.log('Device Details:', deviceDetails);

    ws.send(JSON.stringify({
      type: 'DEVICE_LIST',
      devices: deviceDetails.filter(device => device !== null)
    }));
  } catch (error) {
    console.error('Error listing devices:', error);
    ws.send(JSON.stringify({
      type: 'ERROR',
      message: 'Failed to list devices: ' + error.message
    }));
  }
}

// 启动设备
async function startDevice(deviceId, ws) {
  try {
    console.log(`Starting device ${deviceId}...`);
    
    // 检查设备是否已经启动
    if (devices.has(deviceId)) {
      console.log(`Device ${deviceId} is already running`);
      const deviceInfo = devices.get(deviceId);
      ws.send(JSON.stringify({
        type: 'DEVICE_STARTED',
        deviceId,
        videoUrl: deviceInfo.videoUrl,
        deviceInfo: deviceInfo.info
      }));
      return;
    }
    
    // 检查设备连接状态
    const isConnected = await adbManager.checkDeviceConnection(deviceId);
    if (!isConnected) {
      throw new Error('Device is not connected or not in device mode');
    }
    
    // 启动scrcpy实例
    const { videoPort, controlPort } = await scrcpyLauncher.launch(deviceId);
    console.log(`Scrcpy launched for ${deviceId}: video=${videoPort}, control=${controlPort}`);
    
    // 启动视频流
    const streamUrl = videoStreamer.startStream(deviceId, videoPort);
    console.log(`Video stream started for ${deviceId}: ${streamUrl}`);
    
    // 获取设备详细信息
    const deviceInfo = await adbManager.getDeviceInfo(deviceId);
    
    // 保存设备信息
    devices.set(deviceId, {
      info: deviceInfo,
      controlPort,
      videoPort,
      videoUrl: streamUrl,
      wsConnection: ws,
      startTime: new Date()
    });
    
    // 通知客户端设备已启动
    ws.send(JSON.stringify({
      type: 'DEVICE_STARTED',
      deviceId,
      videoUrl: streamUrl,
      deviceInfo
    }));
    
    console.log(`Device ${deviceId} started successfully`);
  } catch (error) {
    console.error(`Error starting device ${deviceId}:`, error);
    ws.send(JSON.stringify({
      type: 'ERROR',
      deviceId,
      message: `Failed to start device: ${error.message}`
    }));
  }
}

// 停止设备
function stopDevice(deviceId) {
  try {
    if (!devices.has(deviceId)) {
      console.log(`Device ${deviceId} is not running`);
      return;
    }
    
    console.log(`Stopping device ${deviceId}...`);
    
    // 停止scrcpy实例
    scrcpyLauncher.stop(deviceId);
    
    // 停止视频流
    videoStreamer.stopStream(deviceId);
    
    // 从设备列表中移除
    devices.delete(deviceId);
    
    console.log(`Device ${deviceId} stopped successfully`);
  } catch (error) {
    console.error(`Error stopping device ${deviceId}:`, error);
  }
}

// 控制设备
function controlDevice(deviceId, command, args) {
  try {
    if (!devices.has(deviceId)) {
      console.error(`Device ${deviceId} not found`);
      return;
    }
    
    const { controlPort } = devices.get(deviceId);
    controlHandler.sendCommand(deviceId, controlPort, command, args);
  } catch (error) {
    console.error(`Error controlling device ${deviceId}:`, error);
  }
}

// 启动HTTP服务器
app.use(express.static(path.join(__dirname, '../../client')));

app.get('/api/devices', async (req, res) => {
  try {
    const deviceIds = await adbManager.listDevices();
    const deviceDetailsPromises = deviceIds.map(device => adbManager.getDeviceInfo(device.serial));
    const deviceDetails = await Promise.all(deviceDetailsPromises);
    res.json(deviceDetails);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`HTTP server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to access the web interface`);
});

// 错误处理
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  
  // 停止所有设备
  for (const deviceId of devices.keys()) {
    stopDevice(deviceId);
  }
  
  // 关闭服务器
  wss.close();
  videoStreamer.close();
  
  process.exit(0);
});

console.log('Scrcpy cluster server started successfully');
console.log('- WebSocket server: ws://localhost:666');
console.log('- HTTP server: http://localhost:3000');
console.log('- Video streaming: http://localhost:8000');