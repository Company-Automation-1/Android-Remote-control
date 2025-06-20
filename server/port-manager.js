class PortManager {
  constructor() {
    this.portPool = {
      // scrcpy端口池：27183-27282 (100个端口)
      available: Array.from({length: 100}, (_, i) => 27183 + i),
      inUse: new Map(), // userId -> port
      reserved: new Set(),
      lastUsed: new Map() // userId -> port (用户上次使用的端口)
    };
    
    console.log(`端口管理器初始化完成，端口池: ${this.portPool.available[0]}-${this.portPool.available[this.portPool.available.length-1]}`);
  }

  // 为用户分配端口
  allocatePort(userId) {
    // 尝试复用用户上次的端口
    const lastPort = this.portPool.lastUsed.get(userId);
    if (lastPort && this.portPool.available.includes(lastPort)) {
      this.usePort(userId, lastPort);
      console.log(`用户 ${userId} 复用端口: ${lastPort}`);
      return lastPort;
    }

    // 分配新端口
    if (this.portPool.available.length === 0) {
      throw new Error('端口池已满，请稍后重试');
    }

    const port = this.portPool.available.shift();
    this.usePort(userId, port);
    console.log(`用户 ${userId} 分配新端口: ${port}`);
    return port;
  }

  // 标记端口为已使用
  usePort(userId, port) {
    // 从可用列表中移除
    const index = this.portPool.available.indexOf(port);
    if (index > -1) {
      this.portPool.available.splice(index, 1);
    }
    
    // 添加到使用中映射
    this.portPool.inUse.set(userId, port);
  }

  // 释放用户端口
  releasePort(userId) {
    const port = this.portPool.inUse.get(userId);
    if (port) {
      this.portPool.inUse.delete(userId);
      this.portPool.available.push(port);
      this.portPool.lastUsed.set(userId, port);
      
      // 保持端口列表有序
      this.portPool.available.sort((a, b) => a - b);
      
      console.log(`用户 ${userId} 释放端口: ${port}`);
    }
  }

  // 获取用户当前使用的端口
  getUserPort(userId) {
    return this.portPool.inUse.get(userId);
  }

  // 检查端口是否可用
  isPortAvailable(port) {
    return this.portPool.available.includes(port);
  }

  // 检查端口是否被使用
  isPortInUse(port) {
    return Array.from(this.portPool.inUse.values()).includes(port);
  }

  // 预留端口
  reservePort(port) {
    if (this.isPortAvailable(port)) {
      const index = this.portPool.available.indexOf(port);
      this.portPool.available.splice(index, 1);
      this.portPool.reserved.add(port);
      console.log(`端口 ${port} 已预留`);
      return true;
    }
    return false;
  }

  // 释放预留端口
  releaseReservedPort(port) {
    if (this.portPool.reserved.has(port)) {
      this.portPool.reserved.delete(port);
      this.portPool.available.push(port);
      this.portPool.available.sort((a, b) => a - b);
      console.log(`预留端口 ${port} 已释放`);
    }
  }

  // 获取端口使用统计
  getUsageStats() {
    const total = 100;
    const inUse = this.portPool.inUse.size;
    const reserved = this.portPool.reserved.size;
    const available = this.portPool.available.length;
    
    return {
      total,
      inUse,
      reserved,
      available,
      utilizationRate: `${((inUse + reserved) / total * 100).toFixed(1)}%`,
      activeUsers: Array.from(this.portPool.inUse.keys()),
      portRanges: {
        start: 27183,
        end: 27282,
        current: {
          min: Math.min(...this.portPool.available),
          max: Math.max(...this.portPool.available)
        }
      }
    };
  }

  // 获取详细端口状态
  getDetailedStatus() {
    const stats = this.getUsageStats();
    const userPorts = {};
    
    for (const [userId, port] of this.portPool.inUse) {
      userPorts[userId] = port;
    }
    
    return {
      ...stats,
      userPorts,
      availablePorts: this.portPool.available.slice(), // 复制数组
      reservedPorts: Array.from(this.portPool.reserved),
      lastUsedPorts: Object.fromEntries(this.portPool.lastUsed)
    };
  }

  // 清理过期的最后使用记录（可选）
  cleanupLastUsed(maxAge = 24 * 60 * 60 * 1000) { // 默认24小时
    const now = Date.now();
    for (const [userId, timestamp] of this.portPool.lastUsed) {
      if (now - timestamp > maxAge) {
        this.portPool.lastUsed.delete(userId);
      }
    }
  }

  // 强制释放所有端口（清理时使用）
  releaseAllPorts() {
    console.log('强制释放所有端口...');
    
    // 将所有使用中的端口归还到可用池
    for (const port of this.portPool.inUse.values()) {
      this.portPool.available.push(port);
    }
    
    // 将所有预留端口归还到可用池
    for (const port of this.portPool.reserved) {
      this.portPool.available.push(port);
    }
    
    // 清空映射
    this.portPool.inUse.clear();
    this.portPool.reserved.clear();
    
    // 重新排序并去重
    this.portPool.available = Array.from(new Set(this.portPool.available)).sort((a, b) => a - b);
    
    console.log(`所有端口已释放，可用端口数: ${this.portPool.available.length}`);
  }

  // 验证端口池完整性
  validatePortPool() {
    const allPorts = new Set();
    
    // 收集所有端口
    this.portPool.available.forEach(port => allPorts.add(port));
    this.portPool.inUse.forEach(port => allPorts.add(port));
    this.portPool.reserved.forEach(port => allPorts.add(port));
    
    const expectedPorts = Array.from({length: 100}, (_, i) => 27183 + i);
    const missingPorts = expectedPorts.filter(port => !allPorts.has(port));
    const extraPorts = Array.from(allPorts).filter(port => !expectedPorts.includes(port));
    
    if (missingPorts.length > 0 || extraPorts.length > 0) {
      console.warn('端口池完整性检查失败:');
      if (missingPorts.length > 0) {
        console.warn('缺失端口:', missingPorts);
      }
      if (extraPorts.length > 0) {
        console.warn('多余端口:', extraPorts);
      }
      return false;
    }
    
    console.log('端口池完整性检查通过');
    return true;
  }
}

module.exports = PortManager; 