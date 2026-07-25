#!/bin/sh
# Entrypoint del gameserver: ajusta config/server.properties segun variables
# de entorno (host de MariaDB y del loginserver de la red de compose) y arranca
# el servidor en primer plano.
set -e

cd /opt/l2/gameserver

: "${DB_HOST:=mariadb}"
: "${DB_PORT:=3306}"
: "${DB_NAME:=l2jdb}"
: "${DB_USER:=l2j}"
: "${DB_PASS:=l2jpass}"
: "${LOGIN_HOST:=loginserver}"
: "${GS_XMX:=2g}"

CFG=config/server.properties

sed -i "s|^URL = .*|URL = jdbc:mariadb://${DB_HOST}:${DB_PORT}/${DB_NAME}|" "$CFG"
sed -i "s|^Login = .*|Login = ${DB_USER}|" "$CFG"
sed -i "s|^Password = .*|Password = ${DB_PASS}|" "$CFG"
sed -i "s|^LoginHost = .*|LoginHost = ${LOGIN_HOST}|" "$CFG"

# Hostname publico que el loginserver entrega a los clientes en la lista de
# servidores. Si no se define, se usa "*" (el login usa la IP del contenedor,
# suficiente para pruebas dentro de la red Docker).
if [ -n "${EXTERNAL_HOSTNAME}" ]; then
	sed -i "s|^Hostname = .*|Hostname = ${EXTERNAL_HOSTNAME}|" "$CFG"
fi

echo "[entrypoint] GameServer -> DB jdbc:mariadb://${DB_HOST}:${DB_PORT}/${DB_NAME} (user ${DB_USER}), login ${LOGIN_HOST}:9014, Xmx=${GS_XMX}"

exec java -Xmx"${GS_XMX}" -cp './libs/*' net.sf.l2j.gameserver.GameServer
