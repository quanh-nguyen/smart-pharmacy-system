const { Server } = require('socket.io');
const { clientOrigin } = require('../../config/env');
const { verifyToken } = require('../../middleware/auth');
const notificationService = require('./notification.service');

// Client kết nối: io(URL, { auth: { token: '<JWT>' } })
// Lắng nghe: 'notification:new', 'order:updated'
function initSocket(httpServer) {
  const io = new Server(httpServer, { cors: { origin: clientOrigin } });

  io.use((socket, next) => {
    try {
      socket.user = verifyToken(socket.handshake.auth?.token);
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.user.id}`);
  });

  notificationService.setIo(io);
  return io;
}

module.exports = { initSocket };
