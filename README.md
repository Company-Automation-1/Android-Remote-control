# Android设备管理器

一个简单的基于 Node.js 和 WebSocket 的 Android 设备列表查看工具。

## 当前功能

- 🔍 **设备发现**: 自动发现通过ADB连接的 Android 设备
- 📱 **设备信息**: 显示设备型号、Android版本、分辨率、序列号等详细信息
- 🌐 **Web界面**: 简洁现代的 Web 用户界面
- 🔄 **实时刷新**: 支持手动刷新设备列表
- 📡 **多设备支持**: 同时显示多个连接的设备

## 系统要求

- Node.js 14.0+
- ADB (Android Debug Bridge)

## 快速开始

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

### 2. 启动项目
```bash
cd server/demo
npm install
npm start
```

### 3. 访问界面
打开浏览器访问: http://localhost:3000

## 使用说明

1. 确保 Android 设备已启用 USB 调试
2. 使用 USB 线连接设备到电脑
3. 在设备上允许 USB 调试授权
4. 访问 Web 界面查看连接的设备列表
5. 点击"刷新设备"按钮更新设备列表

## API 接口

### WebSocket 接口 (ws://localhost:666)

#### 获取设备列表
```json
{
  "action": "LIST_DEVICES"
}
```

### HTTP 接口

#### 获取设备列表
```
GET /api/devices
```

#### 服务器状态
```
GET /api/status
```

## 项目结构

```
demo/
├── client/           # 前端文件
│   ├── index.html    # 主页面
│   ├── script.js     # 客户端逻辑
│   └── style.css     # 样式文件
├── server/demo/      # 后端文件
│   ├── server.js     # 主服务器
│   ├── adb-manager.js # ADB 管理器
│   └── package.json  # 项目配置
└── README.md
```

## 故障排除

### 常见问题

1. **设备未显示**
   - 检查 ADB 是否正确安装: `adb version`
   - 确认设备已启用 USB 调试
   - 运行 `adb devices` 确认设备连接状态
   - 检查设备是否显示为 "device" 状态而非 "unauthorized"

2. **WebSocket 连接失败**
   - 检查服务器是否正常启动
   - 确认端口 666 和 3000 未被占用
   - 检查防火墙设置

3. **获取设备信息失败**
   - 确认设备屏幕已解锁
   - 检查设备的 USB 调试权限
   - 查看服务器控制台日志获取详细错误信息

### 调试模式

启动服务器后，查看控制台输出获取详细日志：
- 设备连接状态
- WebSocket 连接信息
- ADB 命令执行结果
- 错误信息

## 技术栈

- **后端**: Node.js, Express, WebSocket
- **前端**: 原生 HTML/CSS/JavaScript
- **设备通信**: Android Debug Bridge (ADB)

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request 来改进这个项目。 