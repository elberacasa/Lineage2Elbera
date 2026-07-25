-- Registro del gameserver id 1 (L2Vzla) para que el loginserver acepte su hexid
-- (AcceptNewGameServer = False en loginserver.properties).
-- El hexid coincide con dist/gameserver/config/hexid.txt (ServerID=1).
-- Se ejecuta despues de gameservers.sql (orden alfabetico en /docker-entrypoint-initdb.d).
INSERT INTO `gameservers` (`server_id`, `hexid`, `host`)
VALUES (1, '3c338e97acafb0ff0e39843257e474e7', 'gameserver')
ON DUPLICATE KEY UPDATE `hexid` = VALUES(`hexid`), `host` = VALUES(`host`);
