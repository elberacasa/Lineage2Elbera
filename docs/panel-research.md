# Investigación competitiva: creación de servidores de Lineage 2 "en un clic"

> Estado: investigación inicial (julio 2026). Fuentes citadas en línea.
> Objetivo: mapear qué existe hoy para montar/administrar servidores L2 privados y dónde está el hueco para una plataforma one-click en español, orientada a Latinoamérica, con UI de configuración completa (basada en nuestro pack aCis rev 409 / JDK 21).

---

## 1. Paneles de control y administración web para L2J

### 1.1 L2-scripts (l2-scripts.com)
- **URL:** https://l2-scripts.com/ — [lista de precios](https://l2-scripts.com/index.php?show_price=yes)
- **Qué es:** estudio ruso veterano. Vende *packs llave en mano* (L2J y derivados Lucera) y un panel/admin propio. El pack **Interlude cuesta ~100 USD** ([producto](https://l2-scripts.com/index.php?productID=660)); el "Interlude Turnkey server pack" llega a **315–875 USD** según alcance ([enlace](https://l2-scripts.com/index.php?proproductID=662)).
- **Precio:** 100–875 USD por pack, más servicios por hora.
- **Debilidades:** vende *archivos*, no una plataforma: tú sigues necesitando VPS, MariaDB, Java y configuración manual. Todo en ruso/inglés, soporte por tickets lentos, ecosistema cerrado (licencias HWID). No hay self-service ni aprovisionamiento automático.

### 1.2 Lucera2 / "Lineage 2 PDL" panel
- **URL:** https://forum.lucera2.com/threads/lineage-2-pdl-full-web-panel-for-private-servers-lucera2-compatible.6383/
- **Qué es:** panel web completo (gestión de cuentas, reportes, admin) pensado para el emulador de pago **Lucera2**, el estándar de facto del mercado ruso de packs.
- **Precio:** bajo consulta; el ecosistema Lucera2 cobra licencia mensual por el emulador + addons.
- **Debilidades:** atado a Lucera2 (no sirve para aCis ni L2J open source), ruso/inglés, panel orientado al *jugador/donaciones*, no al *provisión del servidor*. No instala nada.

### 1.3 NimeraCP
- **URL:** https://nimeracp.com/
- **Qué es:** el control panel "moderno" más visible para servidores privados L2: shop, ruleta, starter packs, referidos, cupones, gift codes, vinculación de cuentas de juego, Stripe/PayPal/cripto. Anunció "Cloud Hosting" para desplegar instancias.
- **Precio:** no público en la web (contacto/suscripción).
- **Debilidades:** es un panel de **jugador/monetización**, no un aprovisionador: no compila packs, no gestiona configs del gameserver, no hay opción Interlude/aCis explícita. Inglés primero. Su "cloud hosting" es reciente y opaco (sin precios ni specs visibles).

### 1.4 L2JWeb
- **URL:** https://www.l2jweb.com/
- **Qué es:** "Account Control Panel" clásico para L2J: gestión de jugadores, algo de configuración y monitoreo.
- **Precio:** freemium/suscripción (histórico).
- **Debilidades:** generación anterior de herramientas; gestiona una base de datos ya montada, no crea el servidor. Sin foco en LatAm ni en español.

### 1.5 L2Fast (l2fast.ru)
- **URL:** https://l2fast.ru/en/
- **Qué es:** suite rusa: updater/launcher, protección antibot, scripts y un admin panel (app de escritorio + web) con estadísticas, gestión de personajes/clanes/inventario.
- **Precio:** suscripción por módulos (precios en la web, en RUB/USD).
- **Debilidades:** orientado a quien **ya tiene** servidor montado; valor en protección y launcher, no en aprovisionamiento. Ruso primero. Licencias atadas a hardware.

### 1.6 Proyectos open source / semi-abandonados
- **L2 ACP (Account - Admin Control Panel)** — https://maxcheaters.com/topic/214536-l2-acp-account-admin-control-panel/ : ACP open source con API web (puerto 8000). Comunidad pequeña, desarrollo esporádico desde 2017.
- **advanced-gm-panel-lineage-2** y **l2-player-control-panel** (GitHub): repos escaparate con keywords SEO, código dudoso/incompleto; típicos "SEO farms" del nicho. No utilizables en producción.
- **Paneles sueltos en MaxCheaters / L2JBrasil**: plantillas web + ACP que se venden entre **20 y 150 USD** en el marketplace; calidad muy variable, sin soporte, frecuentemente con backdoors reportados por la propia comunidad.

**Resumen del bloque:** todos los paneles asumen que *el servidor ya existe*. Nadie resuelve "quiero un servidor Interlude funcionando en 10 minutos".

---

## 2. Pterodactyl "eggs" para L2J

- Verificado en el repo oficial de eggs (pelican-eggs/eggs, sucesor de parkervcp/eggs tras su migración a read-only en mayo 2024): **no existe ningún egg de Lineage 2 / L2J** (búsqueda `lineage` y `l2j` sobre el árbol del repo, 0 resultados). El catálogo público https://eggs.pterodactyl.io/eggs/games/ tampoco lista ninguno.
- Existen forks personales de colecciones de eggs (p. ej. https://github.com/infectedw/pterodactyl-eggs), pero ninguno conocido para L2.
- **Conclusión:** hueco total. Un egg L2J bien hecho choca además con problemas reales: el stack L2J son **dos procesos** (loginserver + gameserver) más MariaDB, el registro del GameServer en el LoginServer (`RegisterGameServer`/hexid) es manual, y Pterodactyl asume un proceso por servidor. Cualquier egg casero sería un parche frágil — oportunidad para nosotros, pero también señal de que Pterodactyl no es el vehículo natural.

---

## 3. Docker / docker-compose para L2J y aCis

| Proyecto | URL | Qué hace | Debilidades |
|---|---|---|---|
| **l2jserver/l2j-server-docker** (oficial) | imagen en Docker Hub, usada vía compose | Imagen oficial de L2JServer (crónicas modernas, no Interlude) | Stack monolítico, rama `master` = crónicas nuevas; sin UI; configs por variables de entorno limitadas |
| **nonom/l2j-server-docker** | https://github.com/nonom/l2j-server-docker | Compose con login + game server L2J | Mismo problema: crónica moderna, sin panel, config manual |
| **partybrasil/l2j-server-docker** | https://github.com/partybrasil/l2j-server-docker | Compose sobre la imagen oficial + MariaDB alpine | Variables mínimas; sigue exigiendo saber Docker; sin UI de rates/eventos |
| **stsourlidakis/l2jmobius-docker** | https://github.com/stsourlidakis/l2jmobius-docker | L2jMobius (crónicas recientes) "en minutos" | Mobius ≠ Interlude; proyecto pequeño, poco mantenido |
| **Ruk33/l2j-docker** | https://github.com/Ruk33/l2j-docker | Servicios separados (mejor arquitectura) | Abandonado (~2020), L2J clásico, sin aCis |
| **aCis en Docker** | — | **No existe imagen ni compose mantenido para aCis/Interlude** | Hueco directo para nuestro pack aCis rev 409 |

- **Resumen:** todo lo dockerizado apunta a L2JServer/L2jMobius (crónicas modernas) y a usuarios técnicos. Nada de aCis, nada de Interlude, nada con UI de configuración ni multi-tenant, nada en español.

---

## 4. Hosting de servidores L2 (y qué cobran)

| Empresa | URL | Oferta | Precio | Notas |
|---|---|---|---|---|
| **SovaHost** | https://sovahost.net/lineage2-server-hosting/ | VPS/dedicados "para Lineage 2" con anti-DDoS | **€49/mes** (4 GB/40 GB NVMe), 8 GB y 16 GB en planes superiores | Europa; tú instalas todo. Es hardware + DDoS, no plataforma |
| **Games-Service** | https://games-service.net/lineage-2-servers-hosting/ | Hosting L2 por capacidad de online | **29 / 49 / 99 USD/mes** (150 / 350 / 1250 online) | Ruso/europeo; panel propio básico; público RU |
| **MirageContinent (Argentina)** | https://miragecontinent.com/l2.php | VPS semi-dedicado "compatible con Lineage 2" | Según plan VPS | Hosting genérico con página de marketing L2; cero tooling L2 |
| **ArgHosted (Argentina)** | https://arghosted.com/l2.php | Idem (misma plantilla) | Según plan VPS | Igual: marketing SEO, sin valor L2 específico |
| **L2JServices** | https://l2jservices.com/ | Desarrollo L2J a medida (por hora/tarea/proyecto) | Por hora / proyecto | Servicio, no producto |

**Observaciones:**
- En LatAm **no hay hosting especializado en L2 con plataforma**; solo VPS genéricos con una landing que dice "compatible con Lineage 2".
- El precio de referencia del mercado para "servidor L2 alojado" es **~29–99 USD/mes**, y a eso hay que sumarle el pack (100–875 USD one-time en l2-scripts) y horas de setup.
- El modelo dominante sigue siendo: alquilar VPS + contratar a alguien en MaxCheaters/L2JBrasil para "dejarte el server listo" (50–300 USD por setup, calidad impredecible).

---

## 5. Generadores de packs / configuradores en comunidades

- **MaxCheaters marketplace** (https://maxcheaters.com/): se venden packs, mods y "configs listas", pero **no existe un generador/configurador automático de packs**; la "configuración" se hace editando docenas de `.properties` a mano o pagando a terceros.
- **L2JBrasil** (https://www.l2jbrasil.com/): la comunidad hispano/portuguesa más fuerte; circulan packs aCis precompilados (p. ej. [L2-Aelia Interlude base aCis](https://www.l2jbrasil.com/topic/146966-l2-aelia-interlude-base-acis-java-kotlin/)) con mods mezclados sin documentar — exactamente el problema que nuestro pack curado resuelve.
- **Athena Project** (https://athena-project.eu/how-to-create-lineage-2-server/): vende archivos L2J/L2OFF "para crear tu servidor" (Interlude/H5/Classic) — de nuevo, archivos + guía, no plataforma.
- El único "server pack generator" que aparece en búsquedas (serverpackcreator.de) es de **Minecraft**, no de L2: confirma que el concepto no existe en este nicho.

---

## 6. Análisis de huecos (gap analysis)

Nadie en el mercado combina las cuatro cosas. La matriz actual:

| Necesidad | ¿Quién la cubre hoy? |
|---|---|
| Pack Interlude de calidad | l2-scripts, Lucera2, packs sueltos de foros (100–875 USD, sin garantías) |
| Infraestructura | VPS genéricos (SovaHost, Games-Service, OVH, etc., 29–99 USD/mes) |
| Configuración (rates, eventos, mods) | Manual, editando `.properties`, o pagando a terceros |
| Panel de jugador / donaciones | NimeraCP, Lucera2 PDL, ACPs sueltos |
| **Aprovisionamiento one-click del servidor** | **Nadie** |
| **UI de configuración del gameserver (no del jugador)** | **Nadie** |
| **Todo en español, con pagos y soporte LatAm** | **Nadie** |
| **Docker/aCis/Interlude moderno (JDK 21)** | **Nadie** |

**Lo que una plataforma one-click moderna podría ofrecer y ningún competidor tiene:**

1. **Creación de servidor en minutos, no en días**: elegir crónica (empezando por Interlude aCis rev 409), rates y mods desde un wizard → servidor desplegado (loginserver + gameserver + MariaDB) sin tocar SSH. Hoy el camino real es: comprar pack + alquilar VPS + instalar Java/MariaDB + importar schema + editar ~20 archivos de config + registrar hexid. Nadie lo automatiza.
2. **UI de configuración real del gameserver**: rates, eventos (TvT/CTF), offline shops, comandos voiced (`.menu`), anuncios, enchant caps — editados desde formularios web con validación, no desde `.properties`. Los paneles existentes (NimeraCP, PDL) configuran la *web/shop*, no el *emulador*.
3. **Español primero, LatAm primero**: toda la competencia seria es rusa o anglo. Interfaz, docs, soporte y pagos locales (MercadoPago, PIX, transferencias) son un diferenciador sin competencia directa. La comunidad hispana (L2JBrasil, tops hopzone/topzone en español) es enorme y está desatendida en tooling.
4. **Pack curado y mantenido como producto**: en vez del pack anónimo de foro con mods mezclados, un pack aCis con mods propios documentados (offline shops, `.menu`, configs tuneadas) y actualizaciones continuas — suscripción, no compra ciega one-time.
5. **Multi-servidor y multi-tenant**: crear/reiniciar/clonar servidores (x1, x50, PvP) desde el mismo panel; útil para el ciclo típico de "abrir temporada → cerrar → reabrir" de los servers LatAm. Ni Pterodactyl (sin eggs L2) ni los paneles lo plantean.
6. **DevOps moderno como ventaja silenciosa**: contenedores Docker con JDK 21 (nadie dockeriza aCis hoy), backups automáticos de la base de datos, healthchecks y auto-restart. El hueco en Pterodactyl/Docker confirmado arriba significa que llegar primero con esto es barato de defender.
7. **Monetización integrada opcional**: shop/donaciones tipo NimeraCP pero incluida, con pasarelas LatAm, en vez de un producto separado de otro proveedor.

**Riesgos a vigilar:** NimeraCP ya anunció "Cloud Hosting" (podría moverse hacia aprovisionamiento); Lucera2 domina el segmento de pago ruso y podría empaquetar más tooling; la legalidad gris de los servidores privados limita proveedores de pago/hosting mainstream (Stripe/PayPal son sensibles a este nicho).

---

## Apéndice: método

Búsquedas web (julio 2026) sobre: paneles L2J, eggs Pterodactyl (verificación directa del árbol del repo `pelican-eggs/eggs` vía API de GitHub: 0 coincidencias `lineage`/`l2j`), imágenes Docker L2J/aCis, hosting L2 en español/LatAm, y marketplaces (maxcheaters, l2-scripts, lucera2). Los precios citados son los publicados en las fuentes enlazadas en la fecha de la investigación.
