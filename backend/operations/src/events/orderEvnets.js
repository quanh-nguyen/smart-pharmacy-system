// Kênh sự kiện nội bộ: module Orders phát, module Notifications lắng nghe.
// Sự kiện: 'created' ({ order }), 'statusChanged' ({ order, from, to, actor })
const { EventEmitter } = require('events');

module.exports = new EventEmitter();
