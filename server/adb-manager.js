const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execAsync = promisify(exec);

class ADBManager {
  constructor() {
    this.scrcpyProcesses = new Map(); // userId -> process
    this.deviceInfo = new Map(); // deviceSerial -> info
  }
  
  parseDevices(rawOutput) {
    const lines = rawOutput.trim().split('\n');
    const devices = [];
    
    // 从第二行开始解析（跳过标题行）
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line) {
        const [serial, status] = line.split(/\s+/);
        if (serial && status === 'device') {
          devices.push({ serial, status });
        }
      }
    }
    return devices;
  }
  
  async listDevices() {
    try {
      const { stdout } = await execAsync('adb devices');
      const devices = this.parseDevices(stdout);
      console.log(`Found ${devices.length} connected devices`);
      return devices;
    } catch (error) {
      console.error('Error listing ADB devices:', error);
      throw new Error('无法获取设备列表，请确保ADB已安装并添加到PATH');
    }
  }
  
  async getDeviceInfo(deviceId) {
    try {
      console.log(`Getting device info for: ${deviceId}`);
      
      // 检查缓存
      if (this.deviceInfo.has(deviceId)) {
        return this.deviceInfo.get(deviceId);
      }
      
      // 并行获取设备信息，使用Promise.allSettled避免单个失败影响整体
      const [modelResult, versionResult, sizeResult, batteryResult] = await Promise.allSettled([
        execAsync(`adb -s ${deviceId} shell getprop ro.product.model`),
        execAsync(`adb -s ${deviceId} shell getprop ro.build.version.release`),
        execAsync(`adb -s ${deviceId} shell wm size`),
        execAsync(`adb -s ${deviceId} shell dumpsys battery | grep level`)
      ]);
      
      // 解析结果，提供默认值
      const model = modelResult.status === 'fulfilled' 
        ? modelResult.value.stdout.trim() || 'Unknown Device'
        : 'Unknown Device';
        
      const version = versionResult.status === 'fulfilled' 
        ? versionResult.value.stdout.trim() || 'Unknown'
        : 'Unknown';
        
      let resolution = 'Unknown';
      if (sizeResult.status === 'fulfilled' && sizeResult.value.stdout) {
        const sizeOutput = sizeResult.value.stdout.trim();
        if (sizeOutput.includes(':')) {
          resolution = sizeOutput.split(':')[1].trim();
        }
      }

      let battery = 'Unknown';
      if (batteryResult.status === 'fulfilled' && batteryResult.value.stdout) {
        const batteryMatch = batteryResult.value.stdout.match(/level: (\d+)/);
        if (batteryMatch) {
          battery = `${batteryMatch[1]}%`;
        }
      }
      
      const deviceInfo = {
        id: deviceId,
        model,
        version,
        resolution,
        battery,
        serial: deviceId,
        state: 'device',
        lastConnected: null,
        isOnline: true
      };
      
      // 缓存设备信息
      this.deviceInfo.set(deviceId, deviceInfo);
      console.log(`Device info for ${deviceId}:`, deviceInfo);
      return deviceInfo;
      
    } catch (error) {
      console.error(`Error getting device info for ${deviceId}:`, error);
      // 返回基本信息而不是抛出错误
      return {
        id: deviceId,
        model: 'Unknown Device',
        version: 'Unknown',
        resolution: 'Unknown',
        battery: 'Unknown',
        serial: deviceId,
        state: 'device',
        isOnline: true
      };
    }
  }
  
  async checkDeviceConnection(deviceId) {
    try {
      const { stdout } = await execAsync(`adb -s ${deviceId} get-state`);
      return stdout.trim() === 'device';
    } catch (error) {
      console.error(`Error checking device ${deviceId} connection:`, error);
      return false;
    }
  }

  async startScrcpy(deviceSerial, port, userId) {
    try {
      console.log(`Starting scrcpy for device ${deviceSerial} on port ${port} for user ${userId}`);
      
      // 检查设备是否连接
      const isConnected = await this.checkDeviceConnection(deviceSerial);
      if (!isConnected) {
        throw new Error(`设备 ${deviceSerial} 未连接`);
      }

      // 停止该用户的现有进程
      await this.stopScrcpy(userId);

      const scrcpyArgs = [
        '--serial', deviceSerial,
        '--video-encoder', 'OMX.qcom.video.encoder.avc',
        '--video-bit-rate', '4M',
        '--max-fps', '60',
        '--video-codec-options', 'profile=1,level=42',
        '--no-audio',
        '--max-size', '1280',
        '--port', port.toString(),
        '--stay-awake',
        '--turn-screen-off'
      ];

      const scrcpyProcess = spawn('scrcpy', scrcpyArgs);
      
      // 存储进程引用
      this.scrcpyProcesses.set(userId, {
        process: scrcpyProcess,
        deviceSerial,
        port,
        startTime: Date.now()
      });

      // 设置进程事件监听
      this.setupProcessHandlers(scrcpyProcess, userId, deviceSerial);
      
      // 等待进程启动
      await this.waitForScrcpyReady(scrcpyProcess, 10000);
      
      console.log(`scrcpy启动成功: 用户${userId}, 设备${deviceSerial}, 端口${port}`);
      return scrcpyProcess;

    } catch (error) {
      console.error(`启动scrcpy失败: ${error.message}`);
      throw error;
    }
  }

  setupProcessHandlers(process, userId, deviceSerial) {
    process.stdout.on('data', (data) => {
      console.log(`scrcpy[${userId}] stdout: ${data}`);
    });

    process.stderr.on('data', (data) => {
      console.log(`scrcpy[${userId}] stderr: ${data}`);
    });

    process.on('exit', (code, signal) => {
      console.log(`scrcpy进程退出: 用户${userId}, 设备${deviceSerial}, 退出码${code}, 信号${signal}`);
      this.scrcpyProcesses.delete(userId);
    });

    process.on('error', (error) => {
      console.error(`scrcpy进程错误: 用户${userId}, 错误: ${error.message}`);
      this.scrcpyProcesses.delete(userId);
    });
  }

  async waitForScrcpyReady(process, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('scrcpy启动超时'));
      }, timeout);

      const onData = (data) => {
        const output = data.toString();
        if (output.includes('Device:') || output.includes('INFO:')) {
          clearTimeout(timer);
          process.stdout.removeListener('data', onData);
          process.stderr.removeListener('data', onData);
          setTimeout(resolve, 2000); // 额外等待2秒确保就绪
        }
      };

      process.stdout.on('data', onData);
      process.stderr.on('data', onData);

      process.on('exit', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`scrcpy启动失败，退出码: ${code}`));
        }
      });
    });
  }

  async stopScrcpy(userId) {
    const processInfo = this.scrcpyProcesses.get(userId);
    if (processInfo) {
      console.log(`停止scrcpy进程: 用户${userId}, 设备${processInfo.deviceSerial}`);
      
      try {
        // 优雅关闭
        processInfo.process.kill('SIGTERM');
        
        // 等待进程退出，最多3秒
        await Promise.race([
          this.waitForProcessExit(processInfo.process),
          new Promise(resolve => setTimeout(resolve, 3000))
        ]);
        
        // 如果进程仍在运行，强制杀死
        if (!processInfo.process.killed) {
          processInfo.process.kill('SIGKILL');
        }
        
      } catch (error) {
        console.error(`停止scrcpy进程失败: ${error.message}`);
      } finally {
        this.scrcpyProcesses.delete(userId);
      }
    }
  }

  waitForProcessExit(process) {
    return new Promise(resolve => {
      process.on('exit', resolve);
    });
  }

  // 发送触摸事件
  async sendTouchEvent(deviceSerial, x, y, action = 'tap') {
    try {
      let command;
      switch (action) {
        case 'tap':
          command = `adb -s ${deviceSerial} shell input tap ${x} ${y}`;
          break;
        case 'swipe':
          // x, y 应该是起始和结束坐标
          command = `adb -s ${deviceSerial} shell input swipe ${x.startX} ${x.startY} ${x.endX} ${x.endY}`;
          break;
        default:
          throw new Error(`不支持的触摸动作: ${action}`);
      }
      
      await execAsync(command);
      console.log(`触摸事件发送成功: ${deviceSerial}, ${action}, ${x}, ${y}`);
    } catch (error) {
      console.error(`发送触摸事件失败: ${error.message}`);
      throw error;
    }
  }

  // 发送按键事件
  async sendKeyEvent(deviceSerial, keyCode) {
    try {
      const command = `adb -s ${deviceSerial} shell input keyevent ${keyCode}`;
      await execAsync(command);
      console.log(`按键事件发送成功: ${deviceSerial}, keyCode: ${keyCode}`);
    } catch (error) {
      console.error(`发送按键事件失败: ${error.message}`);
      throw error;
    }
  }

  // 发送文本输入
  async sendTextInput(deviceSerial, text) {
    try {
      // 转义特殊字符
      const escapedText = text.replace(/[&;`'"\\$(){}[\]]/g, '\\$&');
      const command = `adb -s ${deviceSerial} shell input text "${escapedText}"`;
      await execAsync(command);
      console.log(`文本输入成功: ${deviceSerial}, text: ${text}`);
    } catch (error) {
      console.error(`文本输入失败: ${error.message}`);
      throw error;
    }
  }

  // 获取设备截图
  async getScreenshot(deviceSerial) {
    try {
      const screenshotPath = `/tmp/screenshot_${deviceSerial}_${Date.now()}.png`;
      await execAsync(`adb -s ${deviceSerial} shell screencap -p > ${screenshotPath}`);
      return screenshotPath;
    } catch (error) {
      console.error(`获取截图失败: ${error.message}`);
      throw error;
    }
  }

  // 清理所有进程
  async cleanup() {
    console.log('清理所有scrcpy进程...');
    const cleanupPromises = Array.from(this.scrcpyProcesses.keys()).map(userId => 
      this.stopScrcpy(userId)
    );
    await Promise.all(cleanupPromises);
    this.deviceInfo.clear();
  }

  // 获取进程状态
  getProcessStatus() {
    const status = {};
    for (const [userId, processInfo] of this.scrcpyProcesses) {
      status[userId] = {
        deviceSerial: processInfo.deviceSerial,
        port: processInfo.port,
        startTime: processInfo.startTime,
        uptime: Date.now() - processInfo.startTime,
        pid: processInfo.process.pid
      };
    }
    return status;
  }
}

module.exports = ADBManager; 