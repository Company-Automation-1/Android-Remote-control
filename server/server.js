const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const ADBManager = require('./adb-manager');

const app = express();
const PORT = process.env.PORT || 3000;
const WS_PORT = 666;

// 创建ADB管理器实例
const adbManager = new ADBManager();

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
        default:
          console.warn('Unknown action:', data.action);
          ws.send(JSON.stringify({
            type: 'ERROR',
            message: `暂不支持的操作: ${data.action}`
          }));
      }
    } catch (error) {
      console.error('Error handling message:', error);
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: '处理消息失败: ' + error.message
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
        devices: [],
        message: '未检测到连接的设备'
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
      message: '获取设备列表失败: ' + error.message
    }));
  }
}

// 启动HTTP服务器
app.use(express.static(path.join(__dirname, '../../client')));

// REST API接口
app.get('/api/devices', async (req, res) => {
  try {
    const deviceIds = await adbManager.listDevices();
    if (deviceIds.length === 0) {
      res.json([]);
      return;
    }
    
    const deviceDetailsPromises = deviceIds.map(device => 
      adbManager.getDeviceInfo(device.serial)
    );
    const deviceDetails = await Promise.all(deviceDetailsPromises);
    res.json(deviceDetails);
  } catch (error) {
    res.status(500).json({ 
      error: error.message,
      message: '获取设备列表失败'
    });
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    server: 'Android Device Manager',
    version: '1.0.0',
    websocket_port: WS_PORT,
    http_port: PORT
  });
});

app.listen(PORT, () => {
  console.log(`HTTP server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to access the web interface`);
});

// 全局错误处理
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  wss.close();
  process.exit(0);
});

console.log('简化版Android设备管理器启动成功!');
console.log('- WebSocket server: ws://localhost:666');
console.log('- HTTP server: http://localhost:3000');
console.log('- 功能: 仅支持设备列表查看'); 