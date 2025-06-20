class ScrcpyClient {
  constructor() {
    this.ws = null;
    this.devices = {};
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.connectWebSocket();
    this.setupUI();
  }

  connectWebSocket() {
    try {
      this.ws = new WebSocket("ws://localhost:666");
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
      this.scheduleReconnect();
    });

    this.ws.addEventListener("error", (error) => {
      console.error("WebSocket error:", error);
    });

    // UI事件
    document.getElementById("refresh").addEventListener("click", () => {
      this.refreshDevices();
    });

    document.getElementById("add-device").addEventListener("click", () => {
      this.showDeviceModal();
    });

    document.querySelector(".close").addEventListener("click", () => {
      this.hideDeviceModal();
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
    
    setTimeout(() => {
      this.connectWebSocket();
    }, delay);
  }

  setupUI() {
    // 添加控制按钮事件委托
    document
      .getElementById("devices-container")
      .addEventListener("click", (e) => {
        if (e.target.classList.contains("control-btn")) {
          const deviceId = e.target.closest(".device-card").dataset.deviceId;
          const command = e.target.dataset.command;
          this.sendControlCommand(deviceId, command);
        }

        if (e.target.classList.contains("stop-btn")) {
          const deviceId = e.target.closest(".device-card").dataset.deviceId;
          this.stopDevice(deviceId);
        }
      });
  }

  refreshDevices() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: "LIST_DEVICES" }));
    } else {
      this.showError("WebSocket连接未建立");
    }
  }

  handleServerMessage(message) {
    console.log("Received message:", message);

    switch (message.type) {
      case "DEVICE_LIST":
        this.updateDeviceList(message.devices);
        break;
      case "DEVICE_STARTED":
        this.addDeviceCard(
          message.deviceId,
          message.videoUrl,
          message.deviceInfo
        );
        break;
      case "ERROR":
        this.showError(message.message, message.deviceId);
        break;
    }
  }

  updateDeviceList(devices) {
    const deviceList = document.getElementById("device-list");
    deviceList.innerHTML = "";

    if (devices.length === 0) {
      deviceList.innerHTML = '<div class="no-devices">未检测到设备</div>';
      return;
    }

    devices.forEach((device) => {
      const deviceItem = document.createElement("div");
      deviceItem.className = "device-item";
      deviceItem.innerHTML = `
        <h3>${device.model}</h3>
        <p>ID: ${device.id}</p>
        <p>Android ${device.version} | ${device.resolution}</p>
      `;
      deviceItem.addEventListener("click", () => {
        this.startDevice(device.id);
        this.hideDeviceModal();
      });
      deviceList.appendChild(deviceItem);
    });
  }

  showDeviceModal() {
    document.getElementById("device-modal").style.display = "block";
    this.refreshDevices();
  }

  hideDeviceModal() {
    document.getElementById("device-modal").style.display = "none";
  }

  showError(message, deviceId = null) {
    console.error(`Error: ${message}`, deviceId ? `(Device: ${deviceId})` : "");
    alert(`错误: ${message}${deviceId ? `\n设备: ${deviceId}` : ""}`);
  }

  startDevice(deviceId) {
    this.ws.send(
      JSON.stringify({
        action: "START_DEVICE",
        deviceId,
      })
    );
  }

  stopDevice(deviceId) {
    this.ws.send(
      JSON.stringify({
        action: "STOP_DEVICE",
        deviceId,
      })
    );

    const deviceCard = document.querySelector(
      `.device-card[data-device-id="${deviceId}"]`
    );
    if (deviceCard) {
      deviceCard.remove();
    }
  }

  addDeviceCard(deviceId, videoUrl, deviceInfo) {
    // 如果设备卡片已存在，先移除
    const existingCard = document.querySelector(
      `.device-card[data-device-id="${deviceId}"]`
    );
    if (existingCard) {
      existingCard.remove();
    }

    // 创建新的设备卡片
    const deviceCard = document.createElement("div");
    deviceCard.className = "device-card";
    deviceCard.dataset.deviceId = deviceId;

    deviceCard.innerHTML = `
      <div class="device-header">
        <div class="device-info">
          <h3>${deviceInfo.model}</h3>
          <p>ID: ${deviceId}</p>
          <p>Android ${deviceInfo.version} | ${deviceInfo.resolution}</p>
        </div>
        <div class="device-actions">
          <button class="stop-btn">断开</button>
        </div>
      </div>
      <div class="video-container">
        <video autoplay playsinline></video>
      </div>
      <div class="device-controls">
        <button class="control-btn" data-command="BACK">←</button>
        <button class="control-btn" data-command="HOME">⌂</button>
        <button class="control-btn" data-command="MENU">≡</button>
        <button class="control-btn" data-command="VOLUME_UP">+</button>
        <button class="control-btn" data-command="VOLUME_DOWN">-</button>
      </div>
    `;

    // 添加到设备容器
    document.getElementById("devices-container").appendChild(deviceCard);

    // 设置视频流
    const videoElement = deviceCard.querySelector("video");
    videoElement.src = videoUrl;

    // 添加触摸控制
    this.setupTouchControls(videoElement, deviceId);

    // 使用Broadway.js解码H.264流
    this.setupH264Decoder(videoElement, deviceId, videoUrl);

    // 添加触摸控制
    this.setupTouchControls(videoElement, deviceId);
  }

  setupTouchControls(videoElement, deviceId) {
    let isTouching = false;

    videoElement.addEventListener("touchstart", (e) => {
      isTouching = true;
      const rect = videoElement.getBoundingClientRect();
      const x = (e.touches[0].clientX - rect.left) / rect.width;
      const y = (e.touches[0].clientY - rect.top) / rect.height;

      this.sendTouchCommand(deviceId, x, y, "DOWN");
      e.preventDefault();
    });

    videoElement.addEventListener("touchmove", (e) => {
      if (!isTouching) return;
      const rect = videoElement.getBoundingClientRect();
      const x = (e.touches[0].clientX - rect.left) / rect.width;
      const y = (e.touches[0].clientY - rect.top) / rect.height;

      this.sendTouchCommand(deviceId, x, y, "MOVE");
      e.preventDefault();
    });

    videoElement.addEventListener("touchend", (e) => {
      isTouching = false;
      this.sendTouchCommand(deviceId, 0, 0, "UP");
      e.preventDefault();
    });
  }

  sendControlCommand(deviceId, command) {
    let commandData = {};

    switch (command) {
      case "BACK":
        commandData = {
          command: "KEYCODE",
          args: { keyCode: 4, action: "DOWN" },
        };
        break;
      case "HOME":
        commandData = {
          command: "KEYCODE",
          args: { keyCode: 3, action: "DOWN" },
        };
        break;
      case "MENU":
        commandData = {
          command: "KEYCODE",
          args: { keyCode: 82, action: "DOWN" },
        };
        break;
      case "VOLUME_UP":
        commandData = {
          command: "KEYCODE",
          args: { keyCode: 24, action: "DOWN" },
        };
        break;
      case "VOLUME_DOWN":
        commandData = {
          command: "KEYCODE",
          args: { keyCode: 25, action: "DOWN" },
        };
        break;
    }

    this.ws.send(
      JSON.stringify({
        action: "CONTROL_DEVICE",
        deviceId,
        ...commandData,
      })
    );
  }

  sendTouchCommand(deviceId, x, y, action) {
    this.ws.send(
      JSON.stringify({
        action: "CONTROL_DEVICE",
        deviceId,
        command: "TOUCH",
        args: { x, y, action },
      })
    );
  }
}

// 初始化客户端
document.addEventListener("DOMContentLoaded", () => {
  const client = new ScrcpyClient();
});
