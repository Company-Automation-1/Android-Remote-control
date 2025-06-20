const { v4: uuidv4 } = require('uuid');

class UserSession {
  constructor(userId, adbManager, portManager) {
    this.userId = userId;
    this.sessionId = uuidv4();
    this.adbManager = adbManager;
    this.portManager = portManager;
    
    // 设备状态
    this.currentDevice = null;
    this.assignedPort = null;
    
    // 会话状态
    this.status = 'idle'; // idle/connecting/connected/switching/disconnected/error
    this.lastActivity = Date.now();
    this.deviceHistory = [];
    this.switchingInProgress = false;
    this.switchProgress = 0;
    this.switchMessage = '';
    
    // WebSocket连接
    this.wsConnection = null;
    
    // 统计信息
    this.stats = {
      switchCount: 0,
      totalUptime: 0,
      lastSwitchTime: null,
      averageSwitchDuration: 0
    };

    console.log(`用户会话创建: ${this.userId} (${this.sessionId})`);
  }

  // 设置WebSocket连接
  setWebSocketConnection(ws) {
    this.wsConnection = ws;
    this.updateActivity();
    console.log(`用户 ${this.userId} WebSocket连接已建立`);
  }

  // 发送消息给客户端
  notifyClient(message) {
    if (this.wsConnection && this.wsConnection.readyState === 1) { // WebSocket.OPEN = 1
      try {
        this.wsConnection.send(JSON.stringify(message));
      } catch (error) {
        console.error(`发送消息失败 ${this.userId}:`, error.message);
      }
    }
  }

  // 更新最后活动时间
  updateActivity() {
    this.lastActivity = Date.now();
  }

  // 切换到指定设备
  async switchToDevice(deviceSerial) {
    if (this.switchingInProgress || deviceSerial === this.currentDevice) {
      return false;
    }

    const switchStartTime = Date.now();
    this.switchingInProgress = true;
    this.status = 'switching';
    this.updateActivity();

    try {
      console.log(`用户 ${this.userId} 开始切换到设备: ${deviceSerial}`);

      // 1. 通知客户端开始切换
      this.updateSwitchProgress(10, '准备切换设备...');

      // 2. 优雅关闭当前连接
      await this.gracefulShutdown();
      this.updateSwitchProgress(40, '正在断开当前设备...');

      // 3. 分配端口
      this.assignedPort = this.portManager.allocatePort(this.userId);
      this.updateSwitchProgress(60, '正在启动新设备连接...');

      // 4. 启动新设备连接
      await this.adbManager.startScrcpy(deviceSerial, this.assignedPort, this.userId);
      this.updateSwitchProgress(80, '正在建立连接...');

      // 5. 完成切换
      this.currentDevice = deviceSerial;
      this.status = 'connected';
      this.addToHistory(deviceSerial);
      
      // 更新统计信息
      const switchDuration = Date.now() - switchStartTime;
      this.stats.switchCount++;
      this.stats.lastSwitchTime = switchStartTime;
      this.updateAverageSwitchDuration(switchDuration);

      this.updateSwitchProgress(100, '切换完成');
      
      // 获取设备信息并通知客户端
      const deviceInfo = await this.adbManager.getDeviceInfo(deviceSerial);
      this.notifyClient({
        type: 'DEVICE_SWITCHED',
        device: deviceInfo,
        progress: 100,
        sessionInfo: this.getSessionInfo()
      });

      // 2秒后隐藏进度条
      setTimeout(() => {
        this.switchingInProgress = false;
        this.switchProgress = 0;
        this.switchMessage = '';
      }, 2000);

      console.log(`用户 ${this.userId} 设备切换成功: ${deviceSerial}, 耗时: ${switchDuration}ms`);
      return true;

    } catch (error) {
      this.status = 'error';
      this.switchingInProgress = false;
      
      // 释放端口
      if (this.assignedPort) {
        this.portManager.releasePort(this.userId);
        this.assignedPort = null;
      }

      console.error(`用户 ${this.userId} 设备切换失败:`, error.message);
      
      this.notifyClient({
        type: 'SWITCH_ERROR',
        message: `切换失败: ${error.message}`,
        error: error.message
      });

      return false;
    }
  }

  // 更新切换进度
  updateSwitchProgress(progress, message) {
    this.switchProgress = progress;
    this.switchMessage = message;
    
    this.notifyClient({
      type: 'PROGRESS',
      progress,
      message
    });
  }

  // 优雅关闭当前连接
  async gracefulShutdown() {
    if (this.currentDevice) {
      console.log(`用户 ${this.userId} 优雅关闭设备连接: ${this.currentDevice}`);
      
      try {
        // 停止scrcpy进程
        await this.adbManager.stopScrcpy(this.userId);
        
        // 释放端口
        if (this.assignedPort) {
          this.portManager.releasePort(this.userId);
          this.assignedPort = null;
        }
        
        this.currentDevice = null;
        
      } catch (error) {
        console.error(`用户 ${this.userId} 关闭连接失败:`, error.message);
      }
    }
  }

  // 添加到设备历史
  addToHistory(deviceSerial) {
    const historyEntry = {
      deviceSerial,
      timestamp: Date.now(),
      sessionId: this.sessionId
    };
    
    // 移除重复的设备记录
    this.deviceHistory = this.deviceHistory.filter(item => item.deviceSerial !== deviceSerial);
    
    // 添加到开头
    this.deviceHistory.unshift(historyEntry);
    
    // 限制历史记录数量
    if (this.deviceHistory.length > 10) {
      this.deviceHistory = this.deviceHistory.slice(0, 10);
    }
  }

  // 更新平均切换时间
  updateAverageSwitchDuration(duration) {
    if (this.stats.averageSwitchDuration === 0) {
      this.stats.averageSwitchDuration = duration;
    } else {
      this.stats.averageSwitchDuration = 
        (this.stats.averageSwitchDuration + duration) / 2;
    }
  }

  // 发送触摸事件
  async sendTouchEvent(x, y, action = 'tap') {
    if (!this.currentDevice) {
      throw new Error('没有连接的设备');
    }

    this.updateActivity();
    return await this.adbManager.sendTouchEvent(this.currentDevice, x, y, action);
  }

  // 发送按键事件
  async sendKeyEvent(keyCode) {
    if (!this.currentDevice) {
      throw new Error('没有连接的设备');
    }

    this.updateActivity();
    return await this.adbManager.sendKeyEvent(this.currentDevice, keyCode);
  }

  // 发送文本输入
  async sendTextInput(text) {
    if (!this.currentDevice) {
      throw new Error('没有连接的设备');
    }

    this.updateActivity();
    return await this.adbManager.sendTextInput(this.currentDevice, text);
  }

  // 获取设备截图
  async getScreenshot() {
    if (!this.currentDevice) {
      throw new Error('没有连接的设备');
    }

    this.updateActivity();
    return await this.adbManager.getScreenshot(this.currentDevice);
  }

  // 断开当前设备
  async disconnect() {
    console.log(`用户 ${this.userId} 主动断开连接`);
    await this.gracefulShutdown();
    this.status = 'disconnected';
    
    this.notifyClient({
      type: 'DISCONNECTED',
      message: '已断开设备连接'
    });
  }

  // 获取会话信息
  getSessionInfo() {
    return {
      userId: this.userId,
      sessionId: this.sessionId,
      currentDevice: this.currentDevice,
      assignedPort: this.assignedPort,
      status: this.status,
      lastActivity: this.lastActivity,
      uptime: Date.now() - (this.stats.lastSwitchTime || Date.now()),
      deviceHistory: this.deviceHistory.slice(0, 5), // 最近5个设备
      stats: {
        ...this.stats,
        sessionDuration: Date.now() - this.lastActivity
      }
    };
  }

  // 获取详细状态
  getDetailedStatus() {
    return {
      ...this.getSessionInfo(),
      switchingInProgress: this.switchingInProgress,
      switchProgress: this.switchProgress,
      switchMessage: this.switchMessage,
      hasWebSocket: !!this.wsConnection,
      webSocketState: this.wsConnection ? this.wsConnection.readyState : null,
      memoryUsage: process.memoryUsage(),
      fullDeviceHistory: this.deviceHistory
    };
  }

  // 检查会话是否空闲
  isIdle(timeoutMs = 300000) { // 默认5分钟
    return Date.now() - this.lastActivity > timeoutMs;
  }

  // 检查会话是否活跃
  isActive() {
    return this.status === 'connected' && this.currentDevice && !this.isIdle();
  }

  // 清理会话
  async cleanup() {
    console.log(`清理用户会话: ${this.userId}`);
    
    try {
      // 断开设备连接
      await this.gracefulShutdown();
      
      // 关闭WebSocket连接
      if (this.wsConnection) {
        this.wsConnection.close();
        this.wsConnection = null;
      }
      
      this.status = 'cleanup';
      
    } catch (error) {
      console.error(`清理会话失败 ${this.userId}:`, error.message);
    }
  }

  // 重新连接设备
  async reconnect() {
    if (!this.currentDevice) {
      throw new Error('没有当前设备可重连');
    }

    console.log(`用户 ${this.userId} 重新连接设备: ${this.currentDevice}`);
    return await this.switchToDevice(this.currentDevice);
  }

  // 心跳检测
  heartbeat() {
    this.updateActivity();
    
    this.notifyClient({
      type: 'HEARTBEAT',
      timestamp: Date.now(),
      sessionInfo: this.getSessionInfo()
    });
  }

  // 获取性能指标
  getMetrics() {
    const now = Date.now();
    const sessionDuration = now - this.lastActivity;
    
    return {
      userId: this.userId,
      sessionId: this.sessionId,
      status: this.status,
      uptime: sessionDuration,
      switchCount: this.stats.switchCount,
      averageSwitchTime: this.stats.averageSwitchDuration,
      lastSwitchTime: this.stats.lastSwitchTime,
      deviceHistoryCount: this.deviceHistory.length,
      currentDevice: this.currentDevice,
      assignedPort: this.assignedPort,
      isActive: this.isActive(),
      isIdle: this.isIdle()
    };
  }
}

module.exports = UserSession; 