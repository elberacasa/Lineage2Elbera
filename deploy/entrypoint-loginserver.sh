#!/bin/sh
# Entrypoint del loginserver: ajusta config/loginserver.properties segun
# variables de entorno y arranca el servidor en primer plano.
set -e

cd /opt/l2/login

: "${DB_HOST:=mariadb}"
: "${DB_PORT:=3306}"
: "${DB_NAME:=l2jdb}"
: "${DB_USER:=l2j}"
: "${DB_PASS:?Set DB_PASS explicitly in the private deployment environment}"
: "${LS_XMX:=64m}"

CFG=config/loginserver.properties

export DB_PASS
sh /usr/local/lib/elbera/write-db-password.sh "$CFG"
sed -i "s|^URL = .*|URL = jdbc:mariadb://${DB_HOST}:${DB_PORT}/${DB_NAME}|" "$CFG"
sed -i "s|^Login = .*|Login = ${DB_USER}|" "$CFG"

echo "[entrypoint] LoginServer -> DB jdbc:mariadb://${DB_HOST}:${DB_PORT}/${DB_NAME} (user ${DB_USER})"

exec java -Xmx"${LS_XMX}" -cp './libs/*' net.sf.l2j.loginserver.LoginServer
