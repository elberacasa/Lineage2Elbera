// L2Vzla M2 WebSocket gateway: browser WebSocket <-> aCis L2 protocol bridge.
'use strict';

const { WebSocketServer } = require('ws');
const { Bridge } = require('./bridge.js');
const { loadNpcNames } = require('./npcnames.js');

const config = {
  wsPort: Number(process.env.GATEWAY_PORT || 8090),
  loginHost: process.env.L2_LOGIN_HOST || '127.0.0.1',
  loginPort: Number(process.env.L2_LOGIN_PORT || 2106),
  serverId: Number(process.env.L2_SERVER_ID || 1),
};

const npcCount = loadNpcNames().size;
const log = (m) => console.log(`[gateway ${new Date().toISOString()}] ${m}`);

const wss = new WebSocketServer({ port: config.wsPort }, () => {
  log(`listening on ws://0.0.0.0:${config.wsPort} (login ${config.loginHost}:${config.loginPort}, serverId ${config.serverId}, ${npcCount} npc names cached)`);
});

wss.on('connection', (ws, req) => {
  log(`client connected from ${req.socket.remoteAddress}`);
  new Bridge(ws, config, log);
});
