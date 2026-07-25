# Manual del Administrador — L2Vzla (Lineage 2 Interlude)

Runbook operativo del servidor. Para la guía dirigida a jugadores, ver `docs/GUIA-JUGADORES.md`.
Para detalles de compilación, ver `server/BUILD-NOTES.md`.

---

## 1. Ficha técnica

| Componente | Detalle |
|---|---|
| Pack | aCis rev 409 (Interlude/C6), paquete raíz `net.sf.l2j` |
| Java | OpenJDK 21 — **obligatorio** `JAVA_HOME=/opt/homebrew/opt/openjdk@21` |
| Árbol desplegable | `server/aCis_gameserver/build/dist/` → `login/` y `gameserver/` |
| Base de datos | MariaDB en `127.0.0.1:3306`, BD `l2jdb`, usuario `l2j` / clave `l2jpass` (ver `db-credentials.txt`), 65 tablas instaladas |
| Puertos | 2106 (login, clientes) · 7777 (gameserver, clientes) · 9014 (enlace login↔game, interno) |
| Geodata | L2OFF, 139 regiones `*_conv.dat`, instalada en `dist/gameserver/data/geodata/` (`GeoDataType = L2OFF`, `GeoDataPath = ./data/geodata/`). Copia maestra en `server/geodata-staging/geodata/` |
| Mods propios | Tiendas offline + comandos de voz `.menu`, `.autoloot`, `.expon`/`.expoff`, `.offline` (compilados en `l2jserver.jar`) |

### Regla de oro: dónde se edita la configuración

- **La fuente definitiva de los configs es `server/aCis_gameserver/config/`.**
- Los configs de `build/dist/*/config/` son **copias generadas por Ant**: cada recompilación ejecuta `ant clean`, borra `build/dist/` completo y lo regenera desde la fuente.
- Por tanto: edita siempre en `server/aCis_gameserver/config/` y deja que el build lo propague. Si editas solo el dist para una prueba rápida, **replica el cambio en la fuente** o lo perderás en el próximo rebuild.
- Lo mismo aplica al datapack: tras cada rebuild hay que re-fusionar `data/` y `serverNames.xml` (comandos exactos en la sección 3).

---

## 2. Arrancar y detener los servidores

### Arranque (en este orden: primero login, luego game)

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export PATH="$JAVA_HOME/bin:$PATH"

cd /Users/alejandroberacasa/l2vzla/server/aCis_gameserver/build/dist/login
./startLoginServer.sh &

cd /Users/alejandroberacasa/l2vzla/server/aCis_gameserver/build/dist/gameserver
./startGameServer.sh &
```

- Los scripts `start*.sh` lanzan los `*_loop.sh` (bucle de auto-reinicio: si el proceso muere, lo levantan de nuevo; en el gameserver, el código de salida `2` fuerza reboot).
- El gameserver corre con `-Xmx2G` (definido en `GameServer_loop.sh`); no lo bajes de 2 GB.
- Requisito previo: MariaDB arriba (`brew services start mariadb`).
- Logs: `dist/login/log/` y `dist/gameserver/log/` (`stdout.log` es el principal; los viejos se rotan con timestamp a cada reinicio).

### Verificar que quedó bien

```bash
tail -f /Users/alejandroberacasa/l2vzla/server/aCis_gameserver/build/dist/gameserver/log/stdout.log
lsof -iTCP:2106 -iTCP:7777 -sTCP:LISTEN
```

En el log del gameserver debe verse la línea `Loaded N voiced command handlers.` (los comandos `.menu`, `.autoloot`, `.expon`, `.expoff`, `.offline` los registra el handler `Menu`) y la conexión al login por el puerto 9014.

### Detención limpia

1. **Desde el juego (recomendado para el gameserver):** con un personaje GM, `//server shutdown <segundos>` — guarda jugadores y tiendas offline y apaga con cuenta regresiva. `//server restart <segundos>` para reiniciar (el loop lo levanta solo), `//server abort` para cancelar.
2. **Desde el sistema operativo:** primero mata el script de bucle y luego el proceso Java; si matas solo el Java, el loop lo revivirá:

```bash
pkill -f GameServer_loop.sh;   pkill -f net.sf.l2j.gameserver.GameServer
pkill -f LoginServer_loop.sh;  pkill -f net.sf.l2j.loginserver.LoginServer
```

Apaga siempre el **gameserver antes que el loginserver**. Un apagado por señal (SIGTERM) también dispara el hook de apagado de aCis y salva el mundo; evita `kill -9` salvo emergencia (pierdes lo no guardado).

---

## 3. Recompilar tras editar código Java

Fuentes en `server/aCis_gameserver/java/` (gameserver) y `server/aCis_datapack/` (datapack).

```bash
cd /Users/alejandroberacasa/l2vzla/server
export JAVA_HOME=/opt/homebrew/opt/openjdk@21

# 1) Compilar (cada uno desde su directorio de módulo)
(cd aCis_gameserver && ant)     # target por defecto: dist
(cd aCis_datapack && ant)       # target por defecto: build

# 2) Re-fusionar el datapack dentro del dist regenerado (el clean lo borró)
rsync -a aCis_datapack/build/gameserver/data/ \
        aCis_gameserver/build/dist/gameserver/data/

# 3) Re-copiar serverNames.xml al login (el loginserver lee ./serverNames.xml)
cp aCis_gameserver/build/dist/gameserver/data/serverNames.xml \
   aCis_gameserver/build/dist/login/serverNames.xml

# 4) Re-instalar la geodata (no viene en el datapack)
cp geodata-staging/geodata/*_conv.dat \
   aCis_gameserver/build/dist/gameserver/data/geodata/
```

Después reinicia ambos servidores (sección 2). No hace falta reinstalar la base de datos: el rebuild no toca MariaDB.

> Si añades un comando de voz nuevo, basta crear la clase en
> `aCis_gameserver/java/net/sf/l2j/gameserver/handler/voicedcommandhandlers/` implementando
> `IVoicedCommandHandler` — el `VoicedCommandHandler` auto-escanea ese paquete al arrancar.

---

## 4. Cambiar rates y configuración de forma segura

Procedimiento:

1. Edita el archivo en `server/aCis_gameserver/config/` (fuente definitiva).
2. Copia ese mismo archivo al dist correspondiente (`build/dist/login/config/` o `build/dist/gameserver/config/`) para no tener que recompilar por un cambio de config.
3. Reinicia el servidor afectado (`//server restart 60` en juego, o a mano). aCis **no** recarga `*.properties` en caliente.

### Claves que más vas a tocar

`gameserver/config/server.properties`:

- Rates: `RateXp`, `RateSp`, `RateDropCurrency` (adena), `RateDropItems`, `RateDropSpoil`, `RateDropHerbs`, `RateDropManor`, `RateQuestRewardAdena` (todas en 1.0 = x1 retail).
- Autoloot global (los jugadores pueden anularlo con `.autoloot`): `AutoLoot`, `AutoLootRaid`, `AutoLootHerbs` (vienen en `False`).
- Red: `Hostname`, `GameserverHostname`, `GameserverPort`, `LoginHost`, `LoginPort` (ver sección 7).

`gameserver/config/players.properties`:

- Tiendas offline (mod propio): `OfflineTradeEnable`, `OfflineCraftEnable`, `OfflineRestoreOnLogin` (las tres en `True`).
- Buffs: `MaxBuffsAmount = 20` (+4 con Divine Inspiration).

`login/config/loginserver.properties`:

- `AutoCreateAccounts = True` (las cuentas se crean solas en el primer login — es intencional).
- Anti-flood: `EnableFloodProtection`, `MaxConnectionPerIP = 50`, `LoginTryBeforeBan = 3`, `LoginBlockAfterBan = 600`.

Consejo: cambia **una cosa a la vez**, anota el valor anterior en el comentario de la línea y prueba. Para balanceo serio, hazlo tras el playtest (ver TODO).

---

## 5. Crear una cuenta GM

En aCis el acceso GM es **por personaje** (tabla `characters`, columna `accesslevel`), no por cuenta.

1. Crea la cuenta entrando al juego normalmente (auto-creación activada) y crea el personaje.
2. Desconecta el personaje y ejecuta en MariaDB:

```bash
mariadb -u l2j -pl2jpass l2jdb \
  -e "UPDATE characters SET accesslevel = 8 WHERE char_name = 'TuPersonaje';"
```

3. Vuelve a entrar. Comandos de admin con `//` (ej. `//admin`, `//server`, `//gmlist`).

Niveles definidos en `dist/gameserver/data/xml/accessLevels.xml`:

| Nivel | Rol | Notas |
|---|---|---|
| -1 | Baneado | El personaje no puede entrar |
| 0 | Usuario | Normal |
| 1–2 | Moderador de chat / GM de prueba | Sin `//` |
| 3–5 | GM general / soporte / eventos | Acceso parcial a comandos |
| 6 | Head GM | Casi todo |
| 7 | Admin | `isGM = true` |
| 8 | Master | Acceso total (úsalo para el dueño) |

La tabla `accounts.access_level` es otra cosa: controla el acceso al **login** (`< 0` = cuenta baneada; `> 0` permite entrar cuando el server está en modo GM-only o lleno). No la uses para dar poderes in-game.

---

## 6. Respaldos de la base de datos

La BD es lo único irrecuperable (cuentas, personajes, clanes, tiendas). Todo lo demás se reconstruye con Ant.

Script sugerido (`~/backup-l2jdb.sh`):

```bash
#!/bin/bash
DEST="$HOME/backups/l2jdb"
mkdir -p "$DEST"
mysqldump -u l2j -pl2jpass --single-transaction --routines l2jdb \
  | gzip > "$DEST/l2jdb-$(date +%Y%m%d-%H%M).sql.gz"
# Conserva solo los últimos 14 días
find "$DEST" -name 'l2jdb-*.sql.gz' -mtime +14 -delete
```

`chmod +x ~/backup-l2jdb.sh` y en cron (`crontab -e`), cada 6 horas:

```
0 */6 * * * $HOME/backup-l2jdb.sh >> $HOME/backups/l2jdb/cron.log 2>&1
```

- `--single-transaction` evita bloquear tablas con el servidor en marcha — el backup se puede hacer en caliente.
- Restaurar: `gunzip < archivo.sql.gz | mariadb -u l2j -pl2jpass l2jdb`.
- Antes de cualquier cambio grande (migración, evento con SQL, limpieza), tira un dump manual primero.
- Cuando el servidor esté en VPS, copia los dumps fuera de la máquina (otro disco, object storage o `scp` periódico a tu PC).

---

## 7. Salir a público para Venezuela

### 7.1 Elegir el VPS

- Lo que manda para Venezuela es la **latencia**: busca VPS con buen enrutado hacia Venezuela — Miami y el norte de Sudamérica (p. ej. São Paulo tiene más salto) suelen dar ~60–90 ms; Europa da 150 ms+.
- Con 2 vCPU / 4 GB RAM alcanza para empezar (el gameserver pide `-Xmx2G` + MariaDB + login).
- Instala JDK 21 y MariaDB en el VPS, sube el `dist/` completo, crea la BD `l2jdb` con su usuario y restaura tu último dump.

### 7.2 Puertos y firewall

Abre/reenvía en el VPS (firewall del SO **y** panel del proveedor):

- **TCP 2106** — loginserver (clientes).
- **TCP 7777** — gameserver (clientes).
- **TCP 9014** — enlace login↔game. Si login y game viven en la misma máquina, **déjalo cerrado al exterior** (es tráfico interno por `127.0.0.1`).

### 7.3 Hostname público en los configs

Edita la fuente (`server/aCis_gameserver/config/`) y replica al dist:

- `loginserver.properties` → `Hostname = <IP_O_DOMINIO_DEL_SERVIDOR>`
  (es la dirección que el login **transmite a los clientes** para que se conecten al game; hoy está en `localhost`, que solo sirve en tu Mac).
- `server.properties` (gameserver) → `Hostname = <IP_O_DOMINIO_DEL_SERVIDOR>`
  (si lo dejas en `*`, el gameserver intenta que el login le resuelva una IP; con dominio público, ponlo explícito).
- Si login y game quedan en máquinas distintas: `server.properties` → `LoginHost = <IP del loginserver>` y abre 9014 solo entre ellas.
- `LoginserverHostname = *` y `GameserverHostname = *` (bind a todas las interfaces) ya están bien para producción.

Usa dominio (p. ej. `login.l2vzla.com`) en vez de IP pelada: si cambias de VPS solo actualizas el DNS y el parche de los jugadores sigue sirviendo.

### 7.4 Parche (carpeta `system`) para los jugadores

1. Toma un cliente Interlude limpio, copia su carpeta `system`.
2. Edita `system/l2.ini`: `ServerAddr=<IP_O_DOMINIO_DEL_SERVIDOR>` (el mismo dominio de arriba). Si el `l2.ini` viene cifrado, usa un editor con soporte L2 (L2FileEdit) para guardarlo legible/cifrado según el cliente.
3. Comprime la carpeta (`system.zip` o `.rar`) y súbela a donde la vas a distribuir.
4. Prueba el parche tú mismo desde una conexión externa antes de publicarlo.

### 7.5 Publicar la guía de jugadores

Rellena los placeholders de `docs/GUIA-JUGADORES.md` antes de difundirla:

- `<URL_DEL_CLIENTE>` — enlace de descarga del cliente Interlude limpio.
- `<URL_DEL_PARCHE>` — enlace de la carpeta `system` del paso 7.4.
- `<IP_O_DOMINIO_DEL_SERVIDOR>` — dominio/IP pública (aparece en `l2.ini`, método hosts y tabla de problemas).
- `<CANAL_DE_SOPORTE>` — Discord/WhatsApp/Telegram del staff (aparece dos veces).

### 7.6 Consideraciones para la comunidad venezolana

- Activa y promociona las **tiendas offline** (`OfflineTradeEnable = True`, `.offline`): muchos jugadores tienen luz e internet intermitentes; que puedan vender con la PC apagada es una ventaja enorme.
- Mantén `AutoCreateAccounts = True`: registro sin fricción.
- Programa los reinicios/mantenimientos con anuncio previo (`//server shutdown 300` da 5 minutos de aviso automático) y en horario razonable para Venezuela (UTC-4).

---

## 8. TODO — lo que falta

- [ ] **Prueba en juego de los mods:** entrar con cliente real y verificar `.menu` (ventana HTML en español, bypasses funcionando), `.autoloot` (toggle por jugador persistido tras relog), `.expon`/`.expoff` (bloqueo de exp), `.offline` (tienda sigue activa con la PC "desconectada") y el restore al login (`OfflineRestoreOnLogin`). Hasta ahora solo está verificado a nivel de compilación/jar, no en gameplay.
- [ ] **Balanceo de rates tras el playtest:** decidir rates finales de XP/SP/drop/adena/spoil con datos reales de juego (hoy todo x1).
- [ ] **Geodata:** confirmar en juego que pathfinding y geo-checks funcionan con los 139 archivos L2OFF (el servidor arranca sin geodata pero sin validación de terreno).
- [ ] **Eventos:** definir calendario (TvT y demás módulos de `events.properties`, eventos manuales con GM de eventos nivel 5).
- [ ] **Presencia web:** página/landing mínima con la guía de jugadores, estado del servidor y enlace al canal de soporte.
- [ ] **Migración a VPS y apertura pública:** ejecutar la sección 7 completa (VPS, puertos, hostnames, parche `system`, placeholders de la guía).
- [ ] **Automatizar backups en el VPS** (sección 6) desde el día 1 en producción.
