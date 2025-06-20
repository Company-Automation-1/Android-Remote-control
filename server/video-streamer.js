const net = require('net');
const http = require('http');

class VideoStreamer {
  constructor() {
    this.streams = new Map();
    this.server = null;
    this.startServer();
  }

  startServer() {
    this.server = http.createServer((req, res) => {
      try {
        // 解析URL获取设备ID
        const urlParts = req.url.split('/');
        if (urlParts.length < 3 || urlParts[1] !== 'stream') {
          this.sendErrorResponse(res, 404, 'Invalid URL format. Use /stream/{deviceId}');
          return;
        }

        const deviceId = urlParts[2];
        
        if (!deviceId || !this.streams.has(deviceId)) {
          this.sendErrorResponse(res, 404, 'Device not found or not streaming');
          return;
        }
        
        const { videoPort } = this.streams.get(deviceId);
        console.log(`Serving video stream for device ${deviceId} from port ${videoPort}`);
        
        // 设置响应头
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'close',
          'Access-Control-Allow-Origin': '*'
        });
        
        // 连接到scrcpy视频流
        const deviceSocket = net.connect(videoPort, 'localhost');
        
        let connected = false;
        
        deviceSocket.on('connect', () => {
          console.log(`Video stream connected for device ${deviceId}`);
          connected = true;
        });
        
        deviceSocket.on('data', (data) => {
          if (connected && !res.destroyed) {
            res.write(data);
          }
        });
        
        deviceSocket.on('end', () => {
          console.log(`Video stream ended for device ${deviceId}`);
          if (!res.destroyed) {
            res.end();
          }
        });
        
        deviceSocket.on('error', (error) => {
          console.error(`Video stream error for device ${deviceId}:`, error);
          if (!res.destroyed) {
            res.end();
          }
        });
        
        // 处理客户端断开连接
        req.on('close', () => {
          console.log(`Client disconnected from video stream for device ${deviceId}`);
          if (deviceSocket && !deviceSocket.destroyed) {
            deviceSocket.destroy();
          }
        });
        
        req.on('error', (error) => {
          console.error(`Request error for device ${deviceId}:`, error);
          if (deviceSocket && !deviceSocket.destroyed) {
            deviceSocket.destroy();
          }
        });
        
      } catch (error) {
        console.error('Error in video streamer:', error);
        this.sendErrorResponse(res, 500, 'Internal server error');
      }
    });
    
    this.server.on('error', (error) => {
      console.error('Video streaming server error:', error);
    });
    
    this.server.listen(8000, () => {
      console.log('Video streaming server running on port 8000');
    });
  }

  sendErrorResponse(res, statusCode, message) {
    if (!res.destroyed) {
      res.writeHead(statusCode, { 'Content-Type': 'text/plain' });
      res.end(message);
    }
  }
  
  startStream(deviceId, videoPort) {
    console.log(`Starting video stream for device ${deviceId} on port ${videoPort}`);
    this.streams.set(deviceId, { videoPort });
    return `http://localhost:8000/stream/${deviceId}`;
  }
  
  stopStream(deviceId) {
    console.log(`Stopping video stream for device ${deviceId}`);
    this.streams.delete(deviceId);
  }

  close() {
    if (this.server) {
      this.server.close();
    }
  }
}

module.exports = VideoStreamer;