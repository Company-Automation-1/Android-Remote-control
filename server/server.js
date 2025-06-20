const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// 引入自定义模块
const ADBManager = require('./adb-manager');
const PortManager = require('./port-manager');
const UserSession = require('./user-session');

// 配置
const config = {
  server: {
    httpPort: process.env.HTTP_PORT || 3000,
    wsPort: process.env.WS_PORT || 666,
    host: process.env.HOST || '0.0.0.0'
  },
  session: {
    idleTimeout: 5 * 60 * 1000, // 5分钟
    cleanupInterval: 60 * 1000,  // 1分钟检查一次
    maxSessions: 100
  },
  scrcpy: {
    defaultBitrate: '4M',
    maxFps: 60,
    maxSize: 1280
  }
};

// 创建Express应用
const app = express();

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态文件服务（如果需要）
app.use('/static', express.static(path.join(__dirname, '../client')));

// 全局管理器实例
const adbManager = new ADBManager();
const portManager = new PortManager();
const userSessions = new Map(); // userId -> UserSession

console.log('🚀 Android设备集群远程控制服务器启动中...');
console.log(`📊 配置信息:`);
console.log(`   HTTP端口: ${config.server.httpPort}`);
console.log(`   WebSocket端口: ${config.server.wsPort}`);
console.log(`   最大会话数: ${config.session.maxSessions}`);

// ========== HTTP API 路由 ==========

// 服务器状态
app.get('/api/status', (req, res) => {
  const stats = portManager.getUsageStats();
  const processStatus = adbManager.getProcessStatus();
  
  res.json({
    status: 'running',
    server: 'Android设备集群远程控制服务器',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    ports: {
      http: config.server.httpPort,
      websocket: config.server.wsPort
    },
    sessions: {
      active: userSessions.size,
      max: config.session.maxSessions,
      details: Array.from(userSessions.values()).map(session => session.getSessionInfo())
    },
    portManager: stats,
    scrcpyProcesses: processStatus,
    systemInfo: {
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      platform: process.platform,
      nodeVersion: process.version
    }
  });
});

// 获取设备列表
app.get('/api/devices', async (req, res) => {
  try {
    const deviceIds = await adbManager.listDevices();
    
    if (deviceIds.length === 0) {
      res.json([]);
      return;
    }
    
    // 并行获取所有设备的详细信息
    const deviceDetailsPromises = deviceIds.map(async device => {
      try {
        return await adbManager.getDeviceInfo(device.serial);
      } catch (error) {
        console.error(`获取设备 ${device.serial} 信息失败:`, error.message);
        return {
          id: device.serial,
          serial: device.serial,
          model: 'Unknown Device',
          version: 'Unknown',
          resolution: 'Unknown',
          battery: 'Unknown',
          state: 'device',
          error: error.message
        };
      }
    });
    
    const deviceDetails = await Promise.all(deviceDetailsPromises);
    res.json(deviceDetails.filter(device => device !== null));
    
  } catch (error) {
    console.error('获取设备列表失败:', error);
    res.status(500).json({
      error: error.message,
      message: '获取设备列表失败'
    });
  }
});

// 获取特定设备信息
app.get('/api/device/:deviceSerial/info', async (req, res) => {
  try {
    const { deviceSerial } = req.params;
    const deviceInfo = await adbManager.getDeviceInfo(deviceSerial);
    res.json(deviceInfo);
  } catch (error) {
    res.status(404).json({
      error: error.message,
      message: `设备 ${req.params.deviceSerial} 信息获取失败`
    });
  }
});

// 设备切换API
app.post('/api/switch-device', async (req, res) => {
  try {
    const { deviceSerial } = req.body;
    const userId = req.headers['user-id'] || `user_${Date.now()}`; // 临时用户ID生成
    
    if (!deviceSerial) {
      return res.status(400).json({
        success: false,
        message: '设备序列号不能为空'
      });
    }
    
    // 获取或创建用户会话
    let userSession = userSessions.get(userId);
    if (!userSession) {
      if (userSessions.size >= config.session.maxSessions) {
        return res.status(503).json({
          success: false,
          message: '服务器会话已满，请稍后重试'
        });
      }
      
      userSession = new UserSession(userId, adbManager, portManager);
      userSessions.set(userId, userSession);
    }
    
    // 执行设备切换
    const success = await userSession.switchToDevice(deviceSerial);
    
    if (success) {
      res.json({
        success: true,
        message: '设备切换成功',
        sessionInfo: userSession.getSessionInfo()
      });
    } else {
      res.status(500).json({
        success: false,
        message: '设备切换失败'
      });
    }
    
  } catch (error) {
    console.error('设备切换API错误:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// 断开设备连接
app.post('/api/disconnect-device', async (req, res) => {
  try {
    const userId = req.headers['user-id'];
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: '用户ID不能为空'
      });
    }
    
    const userSession = userSessions.get(userId);
    if (!userSession) {
      return res.status(404).json({
        success: false,
        message: '用户会话不存在'
      });
    }
    
    await userSession.disconnect();
    
    res.json({
      success: true,
      message: '设备连接已断开'
    });
    
  } catch (error) {
    console.error('断开连接API错误:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// 发送触摸事件
app.post('/api/device/:deviceSerial/touch', async (req, res) => {
  try {
    const { deviceSerial } = req.params;
    const { x, y, action = 'tap' } = req.body;
    const userId = req.headers['user-id'];
    
    const userSession = userSessions.get(userId);
    if (!userSession || userSession.currentDevice !== deviceSerial) {
      return res.status(400).json({
        success: false,
        message: '设备未连接或设备不匹配'
      });
    }
    
    await userSession.sendTouchEvent(x, y, action);
    
    res.json({
      success: true,
      message: '触摸事件发送成功'
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// 发送按键事件
app.post('/api/device/:deviceSerial/key', async (req, res) => {
  try {
    const { deviceSerial } = req.params;
    const { keyCode } = req.body;
    const userId = req.headers['user-id'];
    
    const userSession = userSessions.get(userId);
    if (!userSession || userSession.currentDevice !== deviceSerial) {
      return res.status(400).json({
        success: false,
        message: '设备未连接或设备不匹配'
      });
    }
    
    await userSession.sendKeyEvent(keyCode);
    
    res.json({
      success: true,
      message: '按键事件发送成功'
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// 发送文本输入
app.post('/api/device/:deviceSerial/text', async (req, res) => {
  try {
    const { deviceSerial } = req.params;
    const { text } = req.body;
    const userId = req.headers['user-id'];
    
    const userSession = userSessions.get(userId);
    if (!userSession || userSession.currentDevice !== deviceSerial) {
      return res.status(400).json({
        success: false,
        message: '设备未连接或设备不匹配'
      });
    }
    
    await userSession.sendTextInput(text);
    
    res.json({
      success: true,
      message: '文本输入发送成功'
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// 获取设备截图
app.get('/api/device/:deviceSerial/screenshot', async (req, res) => {
  try {
    const { deviceSerial } = req.params;
    const userId = req.headers['user-id'];
    
    const userSession = userSessions.get(userId);
    if (!userSession || userSession.currentDevice !== deviceSerial) {
      return res.status(400).json({
        success: false,
        message: '设备未连接或设备不匹配'
      });
    }
    
    const screenshotPath = await userSession.getScreenshot();
    res.sendFile(screenshotPath);
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// 获取设备缩略图（占位符）
app.get('/api/device/:deviceSerial/thumbnail', (req, res) => {
  // 返回占位符图片或从缓存获取缩略图
  res.json({
    message: '缩略图功能开发中',
    deviceSerial: req.params.deviceSerial
  });
});

// 系统管理API
app.get('/api/admin/sessions', (req, res) => {
  const sessions = Array.from(userSessions.values()).map(session => 
    session.getDetailedStatus()
  );
  
  res.json({
    totalSessions: userSessions.size,
    sessions,
    portUsage: portManager.getDetailedStatus(),
    systemMetrics: {
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      loadAverage: process.platform !== 'win32' ? require('os').loadavg() : null
    }
  });
});

// 清理空闲会话
app.post('/api/admin/cleanup', async (req, res) => {
  try {
    const { force = false } = req.body;
    let cleanedCount = 0;
    
    for (const [userId, session] of userSessions) {
      if (force || session.isIdle()) {
        await session.cleanup();
        userSessions.delete(userId);
        cleanedCount++;
      }
    }
    
    res.json({
      success: true,
      message: `已清理 ${cleanedCount} 个会话`,
      remainingSessions: userSessions.size
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ========== WebSocket 服务器 ==========

const wss = new WebSocket.Server({ 
  port: config.server.wsPort,
  perMessageDeflate: false
});

console.log(`🔌 WebSocket服务器启动在端口 ${config.server.wsPort}`);

// WebSocket连接处理
wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress;
  const userId = req.url?.split('userId=')[1] || `user_${uuidv4()}`;
  
  console.log(`📱 客户端连接: ${clientIP}, 用户ID: ${userId}`);
  
  // 获取或创建用户会话
  let userSession = userSessions.get(userId);
  if (!userSession) {
    if (userSessions.size >= config.session.maxSessions) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: '服务器会话已满，请稍后重试'
      }));
      ws.close();
      return;
    }
    
    userSession = new UserSession(userId, adbManager, portManager);
    userSessions.set(userId, userSession);
  }
  
  // 设置WebSocket连接
  userSession.setWebSocketConnection(ws);
  
  // 发送当前设备列表
  sendDeviceListToClient(ws);
  
  // WebSocket消息处理
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`📨 收到消息 ${userId}:`, data);
      
      await handleWebSocketMessage(userSession, data);
      
    } catch (error) {
      console.error(`WebSocket消息处理错误 ${userId}:`, error);
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: '处理消息失败: ' + error.message
      }));
    }
  });
  
  // WebSocket连接关闭
  ws.on('close', () => {
    console.log(`🔌 客户端断开: ${clientIP}, 用户ID: ${userId}`);
    
    // 不立即清理会话，允许重连
    setTimeout(async () => {
      const session = userSessions.get(userId);
      if (session && session.isIdle()) {
        console.log(`🧹 清理空闲会话: ${userId}`);
        await session.cleanup();
        userSessions.delete(userId);
      }
    }, 30000); // 30秒后检查是否需要清理
  });

  // WebSocket错误处理
  ws.on('error', (error) => {
    console.error(`WebSocket错误 ${userId}:`, error);
  });
});

// 处理WebSocket消息
async function handleWebSocketMessage(userSession, data) {
  switch (data.action || data.type) {
    case 'LIST_DEVICES':
      await sendDeviceListToClient(userSession.wsConnection);
      break;
      
    case 'SWITCH_DEVICE':
      if (data.deviceSerial) {
        await userSession.switchToDevice(data.deviceSerial);
      } else {
        userSession.notifyClient({
          type: 'ERROR',
          message: '缺少设备序列号'
        });
      }
      break;
      
    case 'TOUCH_EVENT':
      if (data.x !== undefined && data.y !== undefined) {
        await userSession.sendTouchEvent(data.x, data.y, data.action);
      }
      break;
      
    case 'KEY_EVENT':
      if (data.keyCode) {
        await userSession.sendKeyEvent(data.keyCode);
      }
      break;
      
    case 'TEXT_INPUT':
      if (data.text) {
        await userSession.sendTextInput(data.text);
      }
      break;
      
    case 'DISCONNECT':
      await userSession.disconnect();
      break;
      
    case 'HEARTBEAT':
      userSession.heartbeat();
      break;
      
    case 'GET_SESSION_INFO':
      userSession.notifyClient({
        type: 'SESSION_INFO',
        data: userSession.getDetailedStatus()
      });
      break;
      
    default:
      console.warn('未知WebSocket消息类型:', data.action || data.type);
      userSession.notifyClient({
        type: 'ERROR',
        message: `不支持的操作: ${data.action || data.type}`
      });
  }
}

// 发送设备列表给客户端
async function sendDeviceListToClient(ws) {
  try {
    console.log('📱 获取设备列表...');
    const deviceIds = await adbManager.listDevices();
    
    if (deviceIds.length === 0) {
      ws.send(JSON.stringify({
        type: 'DEVICE_LIST',
        devices: [],
        message: '未检测到连接的设备'
      }));
      return;
    }

    // 获取每个设备的详细信息
    const deviceDetailsPromises = deviceIds.map(async device => {
      try {
        return await adbManager.getDeviceInfo(device.serial);
      } catch (error) {
        console.error(`获取设备 ${device.serial} 信息失败:`, error);
        return {
          id: device.serial,
          model: 'Unknown Device',
          version: 'Unknown',
          resolution: 'Unknown',
          battery: 'Unknown',
          serial: device.serial,
          state: 'device',
          error: error.message
        };
      }
    });

    const deviceDetails = await Promise.all(deviceDetailsPromises);
    console.log(`📱 发现 ${deviceDetails.length} 个设备`);

    ws.send(JSON.stringify({
      type: 'DEVICE_LIST',
      devices: deviceDetails.filter(device => device !== null)
    }));
    
  } catch (error) {
    console.error('获取设备列表失败:', error);
    ws.send(JSON.stringify({
      type: 'ERROR',
      message: '获取设备列表失败: ' + error.message
    }));
  }
}

// ========== 定时任务 ==========

// 定期清理空闲会话
setInterval(async () => {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [userId, session] of userSessions) {
    if (session.isIdle(config.session.idleTimeout)) {
      console.log(`🧹 自动清理空闲会话: ${userId}`);
      await session.cleanup();
      userSessions.delete(userId);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`🧹 已清理 ${cleanedCount} 个空闲会话，剩余: ${userSessions.size}`);
  }
  
}, config.session.cleanupInterval);

// 定期验证端口池完整性
setInterval(() => {
  portManager.validatePortPool();
}, 5 * 60 * 1000); // 每5分钟检查一次

// 定期输出系统状态
setInterval(() => {
  const stats = {
    activeSessions: userSessions.size,
    portUsage: portManager.getUsageStats(),
    memory: process.memoryUsage(),
    uptime: process.uptime()
  };
  
  console.log(`📊 系统状态: 活跃会话 ${stats.activeSessions}, 端口使用率 ${stats.portUsage.utilizationRate}, 内存 ${Math.round(stats.memory.heapUsed / 1024 / 1024)}MB`);
}, 2 * 60 * 1000); // 每2分钟输出一次

// ========== 启动服务器 ==========

// 启动HTTP服务器
const httpServer = app.listen(config.server.httpPort, config.server.host, () => {
  console.log(`🌐 HTTP服务器运行在 http://${config.server.host}:${config.server.httpPort}`);
  console.log(`📱 设备管理页面: http://${config.server.host}:${config.server.httpPort}/api/status`);
});

// ========== 优雅关闭处理 ==========

async function gracefulShutdown(signal) {
  console.log(`\n🛑 收到${signal}信号，开始优雅关闭...`);
  
  try {
    // 关闭WebSocket服务器
    wss.close(() => {
      console.log('🔌 WebSocket服务器已关闭');
    });
    
    // 关闭HTTP服务器
    httpServer.close(() => {
      console.log('🌐 HTTP服务器已关闭');
    });
    
    // 清理所有用户会话
    console.log('🧹 清理所有用户会话...');
    const cleanupPromises = Array.from(userSessions.values()).map(session => 
      session.cleanup()
    );
    await Promise.all(cleanupPromises);
    userSessions.clear();
    
    // 清理ADB管理器
    await adbManager.cleanup();
    
    // 释放所有端口
    portManager.releaseAllPorts();
    
    console.log('✅ 服务器已优雅关闭');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ 优雅关闭失败:', error);
    process.exit(1);
  }
}

// 注册信号处理器
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// 全局错误处理
process.on('uncaughtException', (error) => {
  console.error('❌ 未捕获的异常:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ 未处理的Promise拒绝:', reason);
  console.error('Promise:', promise);
});

// 输出启动完成信息
console.log('');
console.log('🎉 Android设备集群远程控制服务器启动完成!');
console.log('');
console.log('📋 服务信息:');
console.log(`   🌐 HTTP API: http://${config.server.host}:${config.server.httpPort}`);
console.log(`   🔌 WebSocket: ws://${config.server.host}:${config.server.wsPort}`);
console.log(`   📊 状态页面: http://${config.server.host}:${config.server.httpPort}/api/status`);
console.log('');
console.log('💡 功能特性:');
console.log('   ✅ 设备发现与管理');
console.log('   ✅ 智能端口分配');
console.log('   ✅ 用户会话管理');
console.log('   ✅ 实时设备切换');
console.log('   ✅ 远程控制操作');
console.log('   ✅ 自动清理机制');
console.log(''); 