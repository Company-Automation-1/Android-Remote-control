const { spawn, exec } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

class ScrcpyLauncher {
  constructor() {
    this.processes = new Map();
    this.controlPorts = new Map();
    this.videoPorts = new Map();
    this.serverJars = new Map();
  }

  async launch(deviceId) {
    return new Promise(async (resolve, reject) => {
      try {
        // 1. 推送scrcpy-server到设备
        exec(`scrcpy -s ${deviceId}`)
        const serverJarPath = await this.pushServerToDevice(deviceId);
        
        // 2. 分配端口
        const videoPort = await this.findAvailablePort(5000, 6000);
        const controlPort = await this.findAvailablePort(6001, 7000);
        
        console.log(`Allocated ports for device ${deviceId}: video=${videoPort}, control=${controlPort}`);
        
        // 3. 启动scrcpy进程 - 使用简化的参数
        const scrcpyArgs = [
          '-s', deviceId,
          '--no-display',
          '--port', videoPort.toString(),
          '--bit-rate', '2M',
          '--max-fps', '15'
        ];
        
        console.log(`Starting scrcpy for device ${deviceId}: scrcpy ${scrcpyArgs.join(' ')}`);
        
        const scrcpy = spawn('scrcpy', scrcpyArgs, {
          stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let startupComplete = false;
        
        // 4. 处理进程事件
        scrcpy.stdout.on('data', (data) => {
          const output = data.toString();
          console.log(`[scrcpy:${deviceId}] stdout: ${output}`);
          
          // 检测启动成功的标志
          if (output.includes('Device:') || output.includes('started')) {
            startupComplete = true;
          }
        });
        
        scrcpy.stderr.on('data', (data) => {
          const output = data.toString();
          console.log(`[scrcpy:${deviceId}] stderr: ${output}`);
        });
        
        scrcpy.on('error', (error) => {
          console.error(`scrcpy error for device ${deviceId}:`, error);
          if (!startupComplete) {
            reject(error);
          }
        });
        
        scrcpy.on('exit', (code, signal) => {
          console.log(`scrcpy for device ${deviceId} exited with code ${code}, signal ${signal}`);
          this.processes.delete(deviceId);
          this.controlPorts.delete(deviceId);
          this.videoPorts.delete(deviceId);
        });
        
        // 5. 保存进程信息
        this.processes.set(deviceId, scrcpy);
        this.controlPorts.set(deviceId, controlPort);
        this.videoPorts.set(deviceId, videoPort);
        this.serverJars.set(deviceId, serverJarPath);
        
        // 6. 等待scrcpy启动完成
        setTimeout(() => {
          if (scrcpy.exitCode === null) {
            console.log(`scrcpy for device ${deviceId} started successfully`);
            resolve({ videoPort, controlPort });
          } else {
            reject(new Error(`scrcpy for device ${deviceId} failed to start`));
          }
        }, 5000); // 增加等待时间
        
      } catch (error) {
        console.error(`Error launching scrcpy for device ${deviceId}:`, error);
        reject(error);
      }
    });
  }
  
  async pushServerToDevice(deviceId) {
    return new Promise((resolve, reject) => {
      // 确定scrcpy-server.jar路径
      const serverJar = this.findScrcpyServer();
      if (!serverJar) {
        reject(new Error('scrcpy-server.jar not found'));
        return;
      }
      
      // 设备上的目标路径
      const devicePath = `/data/local/tmp/scrcpy-server-${Date.now()}.jar`;
      
      // 执行adb push命令
      const adb = spawn('adb', ['-s', deviceId, 'push', serverJar, devicePath]);
      
      adb.stdout.on('data', (data) => {
        console.log(`[adb:${deviceId}] stdout: ${data}`);
      });
      
      adb.stderr.on('data', (data) => {
        console.error(`[adb:${deviceId}] stderr: ${data}`);
      });
      
      adb.on('close', (code) => {
        if (code === 0) {
          console.log(`scrcpy-server pushed to ${deviceId}:${devicePath}`);
          resolve(devicePath);
        } else {
          reject(new Error(`Failed to push scrcpy-server to device ${deviceId}`));
        }
      });
    });
  }
  
  findScrcpyServer() {
    // 尝试在常见位置查找scrcpy-server.jar
    const possiblePaths = [
      '/usr/local/share/scrcpy/scrcpy-server.jar',
      '/usr/share/scrcpy/scrcpy-server.jar',
      path.join(__dirname, 'scrcpy-server.jar'),
      path.join(process.cwd(), 'scrcpy-server.jar'),
      '/opt/homebrew/bin/scrcpy-server.jar' // macOS Homebrew
    ];
    
    for (const path of possiblePaths) {
      if (fs.existsSync(path)) {
        return path;
      }
    }
    
    // 尝试通过which命令查找
    try {
      const scrcpyPath = require('child_process').execSync('which scrcpy').toString().trim();
      if (scrcpyPath) {
        const serverPath = path.join(path.dirname(scrcpyPath), '../share/scrcpy/scrcpy-server.jar');
        if (fs.existsSync(serverPath)) {
          return serverPath;
        }
      }
    } catch (e) {
      // 忽略错误
    }
    
    return null;
  }
  
  stop(deviceId) {
    if (!this.processes.has(deviceId)) return;
    
    try {
      const process = this.processes.get(deviceId);
      process.kill('SIGTERM');
      
      setTimeout(() => {
        if (this.processes.has(deviceId)) {
          process.kill('SIGKILL');
        }
      }, 3000);
      
    } catch (error) {
      console.error(`Error stopping scrcpy for device ${deviceId}:`, error);
    } finally {
      this.processes.delete(deviceId);
      this.controlPorts.delete(deviceId);
      this.videoPorts.delete(deviceId);
      this.serverJars.delete(deviceId);
    }
  }
  
  async findAvailablePort(start, end) {
    for (let port = start; port <= end; port++) {
      const isAvailable = await this.checkPortAvailable(port);
      if (isAvailable) {
        return port;
      }
    }
    throw new Error(`No available port found in range ${start}-${end}`);
  }
  
  checkPortAvailable(port) {
    return new Promise((resolve) => {
      // 检查端口是否已被占用
      const inUse = [...this.controlPorts.values(), ...this.videoPorts.values()].includes(port);
      
      if (inUse) {
        resolve(false);
        return;
      }
      
      // 额外检查系统端口占用情况
      const server = net.createServer();
      
      server.listen(port, () => {
        server.close(() => {
          resolve(true);
        });
      });
      
      server.on('error', () => {
        resolve(false);
      });
    });
  }
}

module.exports = ScrcpyLauncher;