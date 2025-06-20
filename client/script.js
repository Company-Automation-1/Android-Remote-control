class DeviceManager {
  constructor() {
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.connectWebSocket();
    this.setupUI();
  }

  connectWebSocket() {
    try {
      this.ws = new WebSocket("ws://192.168.14.173:666");
      this.setupEventListeners();
    } catch (error) {
      console.error("Failed to create WebSocket connection:", error);
      this.scheduleReconnect();
    }
  }

  setupEventListeners() {
    if (!this.ws) return;

    // WebSocket事件
    this.ws.addEventListener("open", () => {
      console.log("Connected to WebSocket server");
      this.reconnectAttempts = 0;
      this.refreshDevices();
      this.showStatus("已连接到服务器", "success");
    });

    this.ws.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleServerMessage(message);
      } catch (error) {
        console.error("Error parsing message:", error);
      }
    });

    this.ws.addEventListener("close", () => {
      console.log("Disconnected from WebSocket server");
      this.showStatus("与服务器断开连接", "error");
      this.scheduleReconnect();
    });

    this.ws.addEventListener("error", (error) => {
      console.error("WebSocket error:", error);
    });
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("Max reconnection attempts reached");
      this.showError("无法连接到服务器，请检查服务器是否运行");
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    
    console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.showStatus(`正在重连... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`, "warning");
    
    setTimeout(() => {
      this.connectWebSocket();
    }, delay);
  }

  setupUI() {
    // 刷新按钮事件
    document.getElementById("refresh").addEventListener("click", () => {
      this.refreshDevices();
    });

    // 移除添加设备按钮，因为现在只是显示列表
    const addDeviceBtn = document.getElementById("add-device");
    if (addDeviceBtn) {
      addDeviceBtn.style.display = "none";
    }

    // 移除模态框相关事件
    const modal = document.getElementById("device-modal");
    if (modal) {
      modal.style.display = "none";
    }
  }

  refreshDevices() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: "LIST_DEVICES" }));
      this.showStatus("正在获取设备列表...", "info");
    } else {
      this.showError("WebSocket连接未建立");
    }
  }

  handleServerMessage(message) {
    console.log("Received message:", message);

    switch (message.type) {
      case "DEVICE_LIST":
        this.updateDeviceList(message.devices);
        if (message.devices.length > 0) {
          this.showStatus(`发现 ${message.devices.length} 个设备`, "success");
        } else {
          this.showStatus("未检测到连接的设备", "warning");
        }
        break;
      case "ERROR":
        this.showError(message.message);
        break;
      default:
        console.warn("Unknown message type:", message.type);
    }
  }

  updateDeviceList(devices) {
    const container = document.getElementById("devices-container");
    container.innerHTML = "";

    if (devices.length === 0) {
      container.innerHTML = `
        <div class="no-devices">
          <h3>未检测到设备</h3>
          <p>请确保：</p>
          <ul>
            <li>设备已通过USB连接到电脑</li>
            <li>设备已启用USB调试</li>
            <li>已授权此电脑进行调试</li>
            <li>ADB已正确安装并添加到PATH</li>
          </ul>
          <button onclick="deviceManager.refreshDevices()">重新检测</button>
        </div>
      `;
      return;
    }

    devices.forEach((device) => {
      const deviceCard = document.createElement("div");
      deviceCard.className = "device-card";
      deviceCard.innerHTML = `
        <div class="device-info">
          <h3>${device.model}</h3>
          <div class="device-info-item">
            <strong>设备ID:</strong> <span>${device.id}</span>
          </div>
          <div class="device-info-item">
            <strong>系统版本:</strong> <span>Android ${device.version}</span>
          </div>
          <div class="device-info-item">
            <strong>分辨率:</strong> <span>${device.resolution}</span>
          </div>
          <div class="device-info-item">
            <strong>序列号:</strong> <span>${device.serial}</span>
          </div>
        </div>
        <div class="device-actions">
          <div class="device-status">✓ 已连接</div>
        </div>
      `;
      container.appendChild(deviceCard);
    });
  }

  showStatus(message, type = "info") {
    // 创建或更新状态显示
    let statusDiv = document.getElementById("status-message");
    if (!statusDiv) {
      statusDiv = document.createElement("div");
      statusDiv.id = "status-message";
      statusDiv.className = "status-message";
      document.querySelector(".container").insertBefore(statusDiv, document.querySelector(".devices-container"));
    }

    statusDiv.className = `status-message status-${type}`;
    statusDiv.textContent = message;

    // 3秒后自动隐藏成功和信息消息
    if (type === "success" || type === "info") {
      setTimeout(() => {
        if (statusDiv.textContent === message) {
          statusDiv.style.display = "none";
        }
      }, 3000);
    }
  }

  showError(message) {
    console.error(`Error: ${message}`);
    this.showStatus(`错误: ${message}`, "error");
  }
}

// 页面加载完成后初始化
document.addEventListener("DOMContentLoaded", () => {
  window.deviceManager = new DeviceManager();
});
