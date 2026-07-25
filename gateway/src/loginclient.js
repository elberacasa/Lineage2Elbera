// Login server flow (aCis rev 409, port 2106):
//   S->C Init(0x00)                 sessionId, protocol 0xc621, scrambled RSA
//                                   modulus[128], GG[16], blowfish key[16]
//   C->S AuthGameGuard(0x07)        sessionId + 4 dwords
//   S->C GGAuth(0x0b)
//   C->S RequestAuthLogin(0x00)     RSA block[128] (login @0x5E, pass @0x6C)
//   S->C LoginOk(0x03)              loginOk1, loginOk2   (ShowLicence=True)
//   C->S RequestServerList(0x05)
//   S->C ServerList(0x04)
//   C->S RequestServerLogin(0x02)   loginOk pair + serverId
//   S->C PlayOk(0x07)               playOk1, playOk2
'use strict';

const net = require('net');
const { PacketWriter, PacketReader, PacketFramer, frame } = require('./l2io.js');
const { LoginCrypt, unscrambleModulus, rsaEncryptAuthBlock } = require('./crypt.js');
const { gatedConnect } = require('./governor.js');

const LOGIN_PROTOCOL = 0x0000c621;

class LoginError extends Error {}

// Resolves with { sessionKey: {loginOk1, loginOk2, playOk1, playOk2}, server: {id, host, port} }
function login(host, port, account, password, serverId, timeoutMs = 15000) {
  return gatedConnect(() => new Promise((resolve, reject) => {
    const crypt = new LoginCrypt();
    let sessionId = 0;
    let rsaModulus = null;
    let loginOk1 = 0;
    let loginOk2 = 0;
    let server = null;
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      reject(err);
    };
    const timer = setTimeout(() => fail(new LoginError('login flow timed out')), timeoutMs);

    const send = (payload) => sock.write(frame(crypt.encrypt(payload)));

    const framer = new PacketFramer((body) => {
      let plain;
      try {
        plain = Buffer.from(body); // copy: decrypt in place
        if (!crypt.decrypt(plain)) return fail(new LoginError('login packet checksum failed'));
      } catch (e) {
        return fail(e);
      }
      const r = new PacketReader(plain);
      const op = r.readC();
      try {
        switch (op) {
          case 0x00: { // Init
            sessionId = r.readD();
            const protocol = r.readD();
            if (protocol !== LOGIN_PROTOCOL) return fail(new LoginError(`unexpected login protocol ${protocol}`));
            rsaModulus = unscrambleModulus(r.readB(128));
            r.readB(16); // GG, unused
            crypt.setKey(Buffer.from(r.readB(16)));
            // AuthGameGuard
            send(new PacketWriter().writeC(0x07).writeD(sessionId).writeD(0).writeD(0).writeD(0).writeD(0).build());
            break;
          }
          case 0x0b: { // GGAuth -> RequestAuthLogin
            const rsaBlock = rsaEncryptAuthBlock(rsaModulus, account, password);
            send(new PacketWriter().writeC(0x00).writeB(rsaBlock).build());
            break;
          }
          case 0x01: { // LoginFail
            return fail(new LoginError(`LoginFail reason=${r.readD()}`));
          }
          case 0x03: { // LoginOk -> RequestServerList
            loginOk1 = r.readD();
            loginOk2 = r.readD();
            send(new PacketWriter().writeC(0x05).writeD(loginOk1).writeD(loginOk2).build());
            break;
          }
          case 0x04: { // ServerList -> RequestServerLogin
            const count = r.readC();
            r.readC(); // last server
            for (let i = 0; i < count; i++) {
              const id = r.readC();
              const ip = `${r.readC()}.${r.readC()}.${r.readC()}.${r.readC()}`;
              const p = r.readD();
              r.readC(); // age limit
              r.readC(); // pvp
              r.readH(); // current players
              r.readH(); // max players
              const up = r.readC();
              r.readD(); // bits
              r.readC(); // brackets
              if (id === serverId) server = { id, host: ip, port: p, up };
            }
            if (!server) return fail(new LoginError(`server id ${serverId} not in ServerList`));
            if (!server.up) return fail(new LoginError(`server id ${serverId} is DOWN`));
            send(new PacketWriter().writeC(0x02).writeD(loginOk1).writeD(loginOk2).writeC(serverId).build());
            break;
          }
          case 0x06: { // PlayFail
            return fail(new LoginError(`PlayFail reason=${r.readC()}`));
          }
          case 0x07: { // PlayOk
            const playOk1 = r.readD();
            const playOk2 = r.readD();
            clearTimeout(timer);
            settled = true;
            sock.end();
            resolve({
              sessionKey: { loginOk1, loginOk2, playOk1, playOk2 },
              server,
            });
            break;
          }
          default:
            return fail(new LoginError(`unexpected login packet 0x${op.toString(16)}`));
        }
      } catch (e) {
        fail(e);
      }
    });

    const sock = net.connect(port, host);
    sock.on('connect', () => {});
    sock.on('data', (d) => framer.push(d));
    sock.on('error', fail);
    sock.on('close', () => { if (!settled) fail(new LoginError('login socket closed unexpectedly')); });
  }));
}

module.exports = { login, LoginError };
