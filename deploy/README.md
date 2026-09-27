# Deploy Docker — L2Vzla (aCis rev 409, Interlude)

Primero copia `.env.example` a `.env` y completa `DB_ROOT_PASSWORD` y
`DB_PASSWORD` con valores privados. Compose rechaza valores ausentes o vacíos;
no se incluyen contraseñas predeterminadas. No subas el archivo `.env` a Git.
Los entrypoints reciben `DB_PASS` desde `DB_PASSWORD`; si se ejecutan fuera de
Compose, `DB_PASS` también es obligatorio. Esto no rota credenciales existentes
ni cambia las de un volumen MariaDB que ya esté inicializado.

El escritor compartido toma la contraseña únicamente del entorno y la guarda
con escapes Unicode de Java; conserva puntuación, barras, tabulaciones y
espacios, sin interpolarla en `sed` ni incluirla en argumentos o registros.
Acepta UTF-8 válido y rechaza valores vacíos o con saltos de línea. Requiere una
única propiedad `Password` y sustituye el archivo de forma atómica con permisos
`0600`; un error deja el original intacto. Ambos contenedores usan el mismo
usuario para escribir la configuración y ejecutar Java. Los Dockerfiles
comprueban que el sistema base proporciona `awk` y `mktemp`.

Prueba sintética, sin iniciar servicios: `node --test deploy/test/password-config.test.cjs`.
Requiere Node, herramientas POSIX y un JDK (`JAVA_HOME` o `javac`/`java` en PATH)
para contrastar el resultado con `java.util.Properties.load(InputStream)`, el
lector utilizado por `ExProperties` del servidor configurado. No se ha
reconstruido ni arrancado la imagen durante esta comprobación.

Con ese entorno privado configurado, levanta MariaDB, loginserver y gameserver:

```bash
cd deploy
docker compose up -d --build
```

Para detener los servicios conservando la base de datos:

```bash
docker compose down
```

La opción `-v` borra también el volumen de la base de datos; úsala únicamente
si quieres eliminar esos datos deliberadamente.

## Servicios

| Servicio      | Imagen / build                        | Puertos publicados | Rol |
|---------------|---------------------------------------|--------------------|-----|
| `mariadb`     | `mariadb:11.4` (multi-arch)           | ninguno (3306 solo en la red interna) | Base de datos `l2jdb` |
| `loginserver` | `Dockerfile.loginserver` (temurin 21 JRE) | `2106` (clientes), `9014` interno | Autenticación y registro de gameservers |
| `gameserver`  | `Dockerfile.gameserver` (temurin 21 JRE) | `7777` | Mundo de juego, `-Xmx2g` |

- El puerto **3306 no se publica** a propósito: el host ya corre un MariaDB local.
- Las imágenes base (`eclipse-temurin:21-jre`, `mariadb:11.4`) son multi-arch: funcionan igual en macOS arm64 y en un VPS amd64.

## Comprobación de disponibilidad de MariaDB

Compose usa `healthcheck.sh --connect --innodb_initialized`, incluido en la
imagen oficial. Comprueba la conexión TCP y la inicialización de InnoDB sin
pasar una contraseña como argumento. El script utiliza la cuenta de comprobación
y `.my-healthcheck.cnf` del directorio de datos cuando están disponibles.

Un volumen antiguo puede no tener esas cuentas o ese archivo; en ese caso la
comprobación puede fallar aunque el servidor ya esté arrancado. Revisa el estado
del volumen y la [documentación oficial de MariaDB](https://mariadb.com/docs/server/server-management/automated-mariadb-deployment-and-administration/docker-and-mariadb/using-healthcheck-sh)
antes de configurar la comprobación. La documentación describe cómo
`MARIADB_AUTO_UPGRADE=1` recrea el archivo ausente y las cuentas con una contraseña
nueva; este proyecto **no activa esa opción ni modifica o actualiza volúmenes
automáticamente**. No uses `down -v` para resolver un fallo de disponibilidad.

## Cómo funciona

- **Esquema**: los 65 archivos `.sql` de `server/aCis_datapack/sql/` se montan en `/schema:ro` y el entrypoint de MariaDB los copia a `/docker-entrypoint-initdb.d/` junto con `initdb/zz-gameservers.sql` (prefijo `zz-` para correr al final). Solo se ejecutan en el primer arranque del volumen.
  - Nota: no se montan los `.sql` directamente dentro de `/docker-entrypoint-initdb.d` porque Docker Desktop (virtiofs) no admite bind-mounts anidados (archivo dentro de directorio montado).
- **Registro del gameserver**: `initdb/zz-gameservers.sql` inserta la fila `gameservers` (id 1, hexid de `dist/gameserver/config/hexid.txt`), necesaria porque `AcceptNewGameServer = False`.
- **Configs**: los entrypoints (`entrypoint-loginserver.sh`, `entrypoint-gameserver.sh`) ajustan los `.properties` al arrancar el contenedor: la contraseña usa el escritor Unicode privado y los nombres de servicio (`mariadb`, `loginserver`) se aplican por separado según las variables de entorno (`DB_HOST`, `DB_USER`, `LOGIN_HOST`, `GS_XMX`...). El `dist/` original no se modifica.
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
- `.env.example` — nombres de las variables obligatorias, sin credenciales.
- `Dockerfile.loginserver`, `Dockerfile.gameserver` — empaquetan `dist/login` y `dist/gameserver` sobre JRE 21 (el `dist` se pasa como build context nombrado `additional_contexts`, sin copiarlo dentro de `deploy/`).
- `entrypoint-loginserver.sh`, `entrypoint-gameserver.sh` — parcheo de configs por entorno y arranque en primer plano.
- `write-db-password.sh`, `java-password.awk` — escritura privada y escapado de la propiedad Java.
- `initdb/zz-gameservers.sql` — semilla del registro del gameserver id 1.
