const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class ADBManager {
  
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
      
      // 并行获取设备信息，使用Promise.allSettled避免单个失败影响整体
      const [modelResult, versionResult, sizeResult] = await Promise.allSettled([
        execAsync(`adb -s ${deviceId} shell getprop ro.product.model`),
        execAsync(`adb -s ${deviceId} shell getprop ro.build.version.release`),
        execAsync(`adb -s ${deviceId} shell wm size`)
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
      
      const deviceInfo = {
        id: deviceId,
        model,
        version,
        resolution,
        serial: deviceId,
        state: 'device'
      };
      
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
        serial: deviceId,
        state: 'device'
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
}

module.exports = ADBManager; 