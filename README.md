# Scrcpy 集群远程控制系统

一个基于 Node.js 和 WebSocket 的 Android 设备远程控制系统，支持多设备同时控制。

## 功能特性

- 🔍 **设备发现**: 自动发现连接的 Android 设备
- 📱 **设备信息**: 显示设备型号、Android版本、分辨率等信息
- 🎮 **远程控制**: 支持基本的控制操作（返回、主页、菜单、音量等）
- 🌐 **Web界面**: 现代化的 Web 用户界面
- 🔄 **实时连接**: WebSocket 实时通信
- 📡 **多设备支持**: 同时管理多个设备

## 系统要求

- Node.js 14.0+
- ADB (Android Debug Bridge)
- Scrcpy (可选，用于视频流)

## 安装步骤

### 1. 安装 ADB
确保系统中已安装 ADB 并添加到 PATH 环境变量中。

**Windows:**
- 下载 Android SDK Platform Tools
- 将 adb.exe 路径添加到系统 PATH

**macOS:**
```bash
brew install android-platform-tools
```

**Linux:**
```bash
sudo apt install android-tools-adb
```

### 2. 克隆项目
```bash
git clone <repository-url>
cd demo
```

### 3. 安装依赖
```bash
cd server/demo
npm install
```

### 4. 启动服务器
```bash
npm start
```

### 5. 访问 Web 界面
打开浏览器访问: http://localhost:3000

## 使用说明

### 连接设备
1. 确保 Android 设备已启用 USB 调试
2. 使用 USB 线连接设备到电脑
3. 在设备上允许 USB 调试授权
4. 刷新设备列表查看连接的设备

### 控制设备
1. 点击"添加设备"选择要控制的设备
2. 使用底部控制按钮进行基本操作：
   - ← : 返回键
   - ⌂ : 主页键
   - ≡ : 菜单键
   - + : 音量增加
   - - : 音量减少

## API 接口

### WebSocket 接口 (ws://localhost:666)

#### 获取设备列表
```json
{
  "action": "LIST_DEVICES"
}
```

#### 启动设备
```json
{
  "action": "START_DEVICE",
  "deviceId": "设备ID"
}
```

#### 停止设备
```json
{
  "action": "STOP_DEVICE",
  "deviceId": "设备ID"
}
```

#### 控制设备
```json
{
  "action": "CONTROL_DEVICE",
  "deviceId": "设备ID",
  "command": "BACK|HOME|MENU|VOLUME_UP|VOLUME_DOWN",
  "args": {}
}
```

### HTTP 接口

#### 获取设备列表
```
GET /api/devices
```

## 项目结构

```
demo/
├── client/           # 前端文件
│   ├── index.html
│   ├── script.js
│   └── style.css
├── server/demo/      # 后端文件
│   ├── server.js             # 主服务器
│   ├── adb-manager.js        # ADB 管理器
│   ├── scrcpy-launcher.js    # Scrcpy 启动器
│   ├── video-streamer.js     # 视频流处理器
│   ├── control-handler.js    # 控制处理器
│   └── package.json
└── README.md
```

## 故障排除

### 常见问题

1. **设备未显示**
   - 检查 ADB 是否正确安装
   - 确认设备已启用 USB 调试
   - 运行 `adb devices` 确认设备连接

2. **WebSocket 连接失败**
   - 检查服务器是否正常启动
   - 确认端口 666 和 3000 未被占用
   - 检查防火墙设置

3. **控制命令无响应**
   - 确认设备屏幕已解锁
   - 检查设备的 USB 调试权限
   - 查看服务器控制台日志

### 调试信息

启动服务器后，查看控制台输出：
- 设备连接状态
- WebSocket 连接信息
- 命令执行日志
- 错误信息

## 开发计划

- [ ] 视频流功能优化
- [ ] 更多设备控制选项
- [ ] 设备分组管理
- [ ] 批量操作功能
- [ ] 设备状态监控

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request 来改进这个项目。 