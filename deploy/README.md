# Deploy Docker — L2Vzla (aCis rev 409, Interlude)

Levanta el servidor completo (MariaDB + loginserver + gameserver) con un solo comando:

```bash
cd deploy
docker compose up -d --build
```

Para apagar y borrar los datos (volumen de la base incluido):

```bash
docker compose down -v
```

## Servicios

| Servicio      | Imagen / build                        | Puertos publicados | Rol |
|---------------|---------------------------------------|--------------------|-----|
| `mariadb`     | `mariadb:11.4` (multi-arch)           | ninguno (3306 solo en la red interna) | Base de datos `l2jdb` |
| `loginserver` | `Dockerfile.loginserver` (temurin 21 JRE) | `2106` (clientes), `9014` interno | Autenticación y registro de gameservers |
| `gameserver`  | `Dockerfile.gameserver` (temurin 21 JRE) | `7777` | Mundo de juego, `-Xmx2g` |

- El puerto **3306 no se publica** a propósito: el host ya corre un MariaDB local.
- Las imágenes base (`eclipse-temurin:21-jre`, `mariadb:11.4`) son multi-arch: funcionan igual en macOS arm64 y en un VPS amd64.

## Cómo funciona

- **Esquema**: los 65 archivos `.sql` de `server/aCis_datapack/sql/` se montan en `/schema:ro` y el entrypoint de MariaDB los copia a `/docker-entrypoint-initdb.d/` junto con `initdb/zz-gameservers.sql` (prefijo `zz-` para correr al final). Solo se ejecutan en el primer arranque del volumen.
  - Nota: no se montan los `.sql` directamente dentro de `/docker-entrypoint-initdb.d` porque Docker Desktop (virtiofs) no admite bind-mounts anidados (archivo dentro de directorio montado).
- **Registro del gameserver**: `initdb/zz-gameservers.sql` inserta la fila `gameservers` (id 1, hexid de `dist/gameserver/config/hexid.txt`), necesaria porque `AcceptNewGameServer = False`.
- **Configs**: los entrypoints (`entrypoint-loginserver.sh`, `entrypoint-gameserver.sh`) hacen `sed` sobre los `.properties` al arrancar el contenedor, sustituyendo `127.0.0.1` por los nombres de servicio de compose (`mariadb`, `loginserver`) según variables de entorno (`DB_HOST`, `DB_USER`, `DB_PASS`, `LOGIN_HOST`, `GS_XMX`...). El `dist/` original no se modifica.
- **`EXTERNAL_HOSTNAME`** (gameserver): si se define, parchea `Hostname = ` en `server.properties`. Es la dirección que el loginserver entrega a los clientes en la lista de servidores; en producción debe ser la IP/dominio público. Sin definir, el login usa la IP del contenedor (suficiente para pruebas locales dentro de Docker).

## Verificado (2026-07-23, macOS arm64, Docker Desktop, Docker server linux/arm64)

Stack levantado con `docker compose up -d` y comprobado:

- MariaDB `healthy`; `l2jdb` con **65 tablas**; fila `gameservers` = `(1, 3c338e97…, 'gameserver')`.
- Loginserver: `Loginserver ready on *:2106` y `Hooked [1] L2Vzla gameserver on: 172.19.0.4.`
- Gameserver: `Gameserver has started, used memory: 1410 / 2048 Mo.` y `Registered as server: [1] L2Vzla.`; sección de geodata cargada (con un warning benigno de territorio `giran08_2124_096`, presente también en el datapack original).
- Puertos accesibles desde el host: `nc -z 127.0.0.1 7777` y `nc -z 127.0.0.1 2106` → OK.
- `docker compose down -v` ejecutado al final: stack y volumen eliminados.

No verificado: login con cliente L2 real (requiere cliente Interlude y, desde fuera de la red Docker, ajustar `EXTERNAL_HOSTNAME`); build en amd64 (las bases son multi-arch, pero solo se construyó arm64).

## Requisitos

- Docker Desktop (o cualquier Docker con compose v2.17+; probado con v5.0.1) con ~4 GB libres para los contenedores (el gameserver solo usa hasta 2 GB de heap).
- El árbol compilado en `../server/aCis_gameserver/build/dist/` (ver `server/BUILD-NOTES.md`).

## Archivos

- `docker-compose.yml` — los 3 servicios.
- `Dockerfile.loginserver`, `Dockerfile.gameserver` — empaquetan `dist/login` y `dist/gameserver` sobre JRE 21 (el `dist` se pasa como build context nombrado `additional_contexts`, sin copiarlo dentro de `deploy/`).
- `entrypoint-loginserver.sh`, `entrypoint-gameserver.sh` — parcheo de configs por entorno y arranque en primer plano.
- `initdb/zz-gameservers.sql` — semilla del registro del gameserver id 1.
