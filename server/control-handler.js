const { execSync } = require('child_process');

class ControlHandler {
  sendCommand(deviceId, port, command, args) {
    try {
      console.log(`Sending command ${command} to device ${deviceId}`, args);
      
      switch (command) {
        case 'BACK':
          this.sendKeycode(deviceId, 4); // KEYCODE_BACK
          break;
          
        case 'HOME':
          this.sendKeycode(deviceId, 3); // KEYCODE_HOME
          break;
          
        case 'MENU':
          this.sendKeycode(deviceId, 82); // KEYCODE_MENU
          break;
          
        case 'VOLUME_UP':
          this.sendKeycode(deviceId, 24); // KEYCODE_VOLUME_UP
          break;
          
        case 'VOLUME_DOWN':
          this.sendKeycode(deviceId, 25); // KEYCODE_VOLUME_DOWN
          break;
          
        case 'POWER':
          this.sendKeycode(deviceId, 26); // KEYCODE_POWER
          break;
          
        case 'KEYCODE':
          this.sendKeycode(deviceId, args.keyCode);
          break;
          
        case 'TEXT':
          this.sendText(deviceId, args.text);
          break;
          
        case 'TOUCH':
          this.sendTouch(deviceId, args.x, args.y);
          break;
          
        case 'SCROLL':
          this.sendScroll(deviceId, args.x, args.y, args.direction);
          break;
          
        default:
          console.warn(`Unknown command: ${command}`);
      }
    } catch (error) {
      console.error(`Control error for device ${deviceId}:`, error);
    }
  }
  
  sendKeycode(deviceId, keyCode) {
    try {
      execSync(`adb -s ${deviceId} shell input keyevent ${keyCode}`, { timeout: 5000 });
      console.log(`Sent keycode ${keyCode} to device ${deviceId}`);
    } catch (error) {
      console.error(`Error sending keycode ${keyCode} to device ${deviceId}:`, error);
    }
  }
  
  sendText(deviceId, text) {
    try {
      // 转义特殊字符
      const escapedText = text.replace(/['"\\]/g, '\\$&').replace(/\s/g, '%s');
      execSync(`adb -s ${deviceId} shell input text "${escapedText}"`, { timeout: 5000 });
      console.log(`Sent text to device ${deviceId}: ${text}`);
    } catch (error) {
      console.error(`Error sending text to device ${deviceId}:`, error);
    }
  }
  
  sendTouch(deviceId, x, y) {
    try {
      execSync(`adb -s ${deviceId} shell input tap ${x} ${y}`, { timeout: 5000 });
      console.log(`Sent touch to device ${deviceId}: (${x}, ${y})`);
    } catch (error) {
      console.error(`Error sending touch to device ${deviceId}:`, error);
    }
  }
  
  sendScroll(deviceId, x, y, direction) {
    try {
      // 计算滚动终点
      let endX = x;
      let endY = y;
      
      switch (direction) {
        case 'up':
          endY = y - 200;
          break;
        case 'down':
          endY = y + 200;
          break;
        case 'left':
          endX = x - 200;
          break;
        case 'right':
          endX = x + 200;
          break;
        default:
          console.warn(`Unknown scroll direction: ${direction}`);
          return;
      }
      
      execSync(`adb -s ${deviceId} shell input swipe ${x} ${y} ${endX} ${endY}`, { timeout: 5000 });
      console.log(`Sent scroll to device ${deviceId}: (${x}, ${y}) -> (${endX}, ${endY})`);
    } catch (error) {
      console.error(`Error sending scroll to device ${deviceId}:`, error);
    }
  }
  
  wakeDevice(deviceId) {
    try {
      // 先发送唤醒按键
      this.sendKeycode(deviceId, 224); // KEYCODE_WAKEUP
      // 如果没有唤醒按键，使用电源键
      setTimeout(() => {
        this.sendKeycode(deviceId, 26); // KEYCODE_POWER
      }, 500);
      console.log(`Wake command sent to device ${deviceId}`);
    } catch (error) {
      console.error(`Error waking device ${deviceId}:`, error);
    }
  }
  
  unlockDevice(deviceId) {
    try {
      // 向上滑动解锁（适用于大多数设备）
      execSync(`adb -s ${deviceId} shell input swipe 540 1000 540 300`, { timeout: 5000 });
      console.log(`Unlock swipe sent to device ${deviceId}`);
    } catch (error) {
      console.error(`Error unlocking device ${deviceId}:`, error);
    }
  }
}

module.exports = ControlHandler;