# Notas de configuración "bot-friendly" (estilo L2Walker para todos)

**Proyecto:** L2Vzla — servidor Lineage 2 Interlude custom para comunidad venezolana/latina.
**Filosofía:** las ventajas de QoL/automatización que daba L2Walker deben estar disponibles para **todos** los jugadores por igual: autoloot, tiendas offline, buffs generosos, sin anti-bot que bloquee clientes de automatización, voice commands de QoL.

**Fuentes verificadas (2026-07-23):**
- aCis (público): `gitlab.com/Tryskell/acis_public`, rama `master`, configs en `aCis_gameserver/config/`. Keys verificadas contra los `.properties` y contra `aCis_gameserver/java/net/sf/l2j/Config.java`.
- L2JFrozen (1.5): `github.com/Shyla-L2jFrozen/l2jfrozen`, `gameserver/trunk/config/`. Keys verificadas contra los `.properties` y contra `gameserver/trunk/head-src/com/l2jfrozen/Config.java`.

> Las claves marcadas con **[VERIFICADA]** existen textualmente en la fuente indicada. Las marcadas con **[NO VERIFICADA]** no se encontraron y la fase de configuración debe confirmarlas contra los archivos reales del pack elegido.

---

## 0. Decisión de pack (contexto)

| Característica | aCis público | L2JFrozen trunk |
|---|---|---|
| Autoloot / autolearn / subclass sin quest | Sí (config nativa) | Sí (config nativa) |
| Tiendas offline | **No existe en el pack público** (ver §3) | Sí, completo (`fun/offline.properties`) |
| Motor de eventos TvT/CTF/DM | **No** (solo eventos retail: Oly, Seven Signs, Lotería, Pesca) | Sí (`frozen/eventmanager.properties` + configs por evento) |
| Dualbox configurable | Solo `MaximumOnlineUsers` global | `AllowDualBox` / `AllowedBoxes` |
| Anti-bot desactivable | `L2WalkerProtection` (default ya False) | `L2WalkerProtection` (default **True**), `BotProtect`, packet filter, flood protectors |

L2JFrozen trae de fábrica casi todo lo bot-friendly como config; aCis es más retail y limpio pero requiere desarrollo custom para offline shops y eventos. Confirmar con el agente de infraestructura qué pack se eligió.

---

## 1. Autoloot / auto-pickup (incl. herbs)

### aCis — `config/server.properties` **[VERIFICADA]**
```properties
AutoLoot = True          # autoloot general (default False)
AutoLootRaid = True      # autoloot en raid bosses (default False)
AutoLootHerbs = True     # si False, las herbs caen al suelo aun con AutoLoot (default False)
```
Relacionados: `AutoDestroyHerbTime = 15`, `AutoDestroyItemTime = 600`, `AutoDestroyEquipableItemTime = 0` (0 = nunca destruir; subir si el autoloot genera basura en el suelo).

### L2JFrozen — `config/head/altsettings.properties` **[VERIFICADA]**
```properties
AutoLoot = True
AutoLootHerbs = True
AutoLootBoss = True      # equivalente al autoloot de raid (default False)
```

---

## 2. Auto-learn skills y libros

### aCis — `config/players.properties` **[VERIFICADA]**
```properties
AutoLearnSkills = True                # default False
SpBookNeeded = False                  # spellbooks para aprender skills (default True)
DivineInspirationSpBookNeeded = False # spellbook para Divine Inspiration
LifeCrystalNeeded = False             # cristal de vida para skills de clan (opcional)
EnchantSkillSpBookNeeded = True       # libro de gigantes para enchant de skills (decisión de diseño)
```

### L2JFrozen — `config/head/altsettings.properties` **[VERIFICADA]**
```properties
AutoLearnSkills = True
AutoLearnDivineInspiration = True     # auto-aprende los 4 slots extra de buffs
DivineInspirationSpBookNeeded = False
```
Spellbooks generales en L2JFrozen: buscar `SpBookNeeded` / `AltGameSkillLearn` en `head/altsettings.properties` — **[NO VERIFICADA]** en esta pasada; confirmar contra el archivo del pack.

---

## 3. Tiendas offline (trade/craft) — pieza clave del "walker para todos"

### L2JFrozen — `config/fun/offline.properties` **[VERIFICADA]**
```properties
OfflineTradeEnable = true
OfflineCraftEnable = True          # default False en trunk; activar para craft offline
RestoreOffliners = true            # re-loguea tiendas offline tras restart del server
OfflineMaxDays = 0                 # 0 = sin límite de días para el auto-relog
OfflineDisconnectFinished = False  # si True, kickea al terminar de vender (dejar False)
OfflineCommand1 = True             # comando /offline_shop (estilo L2OFF)
OfflineCommand2 = True             # comando .offline_shop (custom; default False)
OfflineLogout = False              # True permite entrar en offline al desloguear (opcional)
OfflineSleepEffect = True          # efecto de sleep estilo L2OFF (cosmético)
OfflineNameColorEnable = False
```

### aCis público **[NO VERIFICADA — no existe como config]**
`Config.java` del pack público **no contiene ninguna key OFFLINE**; las offline shops no están en la versión gratuita. Opciones para la fase de desarrollo:
- Implementar script/custom de offline trade (hay mods públicos estilo "aCis offline shop" en foros; adaptar con cuidado).
- O elegir L2JFrozen como base si las offline shops son requisito de día 1.
Confirmar contra los archivos del pack efectivamente descargado (si se usa una revisión paga de aCis, revisar si incluye la feature).

---

## 4. Dualbox / box allowance

### L2JFrozen — `config/protected/other.properties` **[VERIFICADA]**
```properties
AllowDualBox = True
AllowedBoxes = 99            # default ya 99 = prácticamente ilimitado
AllowDualBoxInOly = False    # dejar False: boxes en Oly rompen la competencia
AllowDualBoxInEvent = False  # idem eventos (TvT/CTF/DM)
```

### aCis **[VERIFICADA parcialmente]**
No hay límite por-IP configurable en el pack público; solo `MaximumOnlineUsers = 100` en `config/server.properties` (subir según capacidad, p.ej. 500-1000). **[NO VERIFICADA]**: si la revisión usada tiene límite de boxes por IP/HWID, buscar en `loginserver.properties` / `server.properties` keys tipo `MaxBoxes`, `DualBoxRestriction`.

---

## 5. Desactivar anti-bot / anti-cheat / captcha — CRÍTICO

### L2JFrozen — `config/protected/other.properties` **[VERIFICADA]**
```properties
L2WalkerProtection = False   # ¡default en trunk es True! Kickea clientes walker. CAMBIAR.
BotProtect = False           # captcha de palabra en combate (default ya False)
# Si se activara alguna vez: BotProtectFirstCheck / BotProtectNextCheck / BotProtectAnsver
```

### L2JFrozen — `config/protected/packets.properties` **[VERIFICADA]**
```properties
UnknownPacketProtection = False   # default True: kickea (UnknownPacketsPunishment = 2) tras
                                  # UnknownPacketsBeforeBan = 5 paquetes "desconocidos".
                                  # Clientes con walker inyectado pueden emitir paquetes
                                  # que el emulador no conoce → desactivar o subir límites.
UnknownPacketsPunishment = 1      # si se deja activo: 1 = solo avisar a GM, nunca kick/ban
```

### aCis — `config/server.properties` **[VERIFICADA]**
```properties
L2WalkerProtection = False   # default ya False; verificar que quede así
```
aCis público no trae captcha ni bot-checker (es retail). **[NO VERIFICADA]**: revisiones/customs de terceros sobre aCis a veces agregan captcha (`gameserver/data/scripts` o mods); revisar que el pack descargado no incluya uno activado.

### Ojo con el nombre trampa
`AllowNpcWalkers = True` (L2JFrozen `config/head/options.properties`) **[VERIFICADA]** se refiere a **NPCs que caminan por las ciudades**, NO a L2Walker. No tocar por este motivo.

---

## 6. Rates para comunidad casual latinoamericana

Valores sugeridos (grinding de tarde/noche, progresión de semanas no meses). Ajustar a gusto del diseño.

### aCis — `config/server.properties` **[VERIFICADA]**
```properties
RateXp = 5.
RateSp = 5.
RatePartyXp = 6.          # leve bonus party para incentivar grupos
RatePartySp = 6.
RateDropCurrency = 4.     # adena y seal stones
RateDropItems = 4.
RateRaidDropItems = 2.    # raids más conservador para no romper economía
RateDropSpoil = 4.
RateDropHerbs = 2.
RateDropManor = 1
RateQuestDrop = 3.
RateQuestReward = 3.
RateQuestRewardXP = 3.
RateQuestRewardSP = 3.
RateQuestRewardAdena = 3.
```

### L2JFrozen — `config/head/rates.properties` **[VERIFICADA]**
```properties
RateXp = 5.00
RateSp = 5.00
RatePartyXp = 6.00
RatePartySp = 6.00
RateDropAdena = 4.00
RateDropItems = 4.00
RateDropSpoil = 4.00
RateDropSealStones = 1.00
RateDropManor = 1
RateDropQuest = 3.00
RateQuestsReward = 3.00
# Herbs (defaults altos: 15/10/4; normalizar a algo razonable):
RateCommonHerbs = 3.00
RateHpMpHerbs = 2.00
RateGreaterHerbs = 1.00
RateSuperiorHerbs = 0.5
RateSpecialHerbs = 0.2
# Bosses:
AdenaBoss = 2.00
ItemsBoss = 2.00
SpoilBoss = 2.00
AdenaRaid = 2.00
ItemsRaid = 2.00
SpoilRaid = 2.00
AdenaMinon = 2.00   # sí, en el archivo está escrito "Minon"
ItemsMinon = 2.00
SpoilMinon = 2.00
```

---

## 7. Buffs: slots y duración

### aCis — `config/players.properties` **[VERIFICADA]**
```properties
MaxBuffsAmount = 24        # default 20; Divine Inspiration suma 4 slots encima de este número
                           # (24 + 4 = 28 slots con DI). Cliente Interlude soporta 20+4 visibles
                           # sin mod; verificar límite visual del cliente en la fase de pruebas.
StoreSkillCooltime = True  # conserva buffs/cooldowns al reloguear
```
Duración de buffs en aCis: **no hay config** en el pack público **[NO VERIFICADA]** — requiere editar XMLs de skills (`data/xml/skills`) o un custom de "buffs de 1-2 horas".

### L2JFrozen — `config/head/altsettings.properties` **[VERIFICADA]**
```properties
MaxBuffAmount = 24         # default 20 (+4 con Divine Inspiration)
MaxDebuffAmount = 8        # default 6
```
Duración — `config/head/other.properties` **[VERIFICADA]**:
```properties
EnableModifySkillDuration = True
SkillDurationList = 264,3600;265,3600;266,3600;267,3600;268,3600;269,3600;270,3600;271,3600;272,3600;273,3600;274,3600;275,3600;276,3600;277,3600;304,3600;305,1200;306,3600;308,3600;349,3600;363,3600;364,3600
# formato: id_skill,segundos;... (songs/dances suelen dejarse en 300-600s, no 3600;
# la lista de arriba es la del ejemplo del propio archivo — revisar IDs antes de aplicar)
```

### Buffer NPC (ambos packs)
- aCis `config/npcs.properties` **[VERIFICADA]**: Scheme Buffer con `//spawn 50002`, `BufferMaxSchemesPerChar = 4`, `BufferStaticCostPerBuff = -1` (poner 0 o un precio fijo en adena).
- L2JFrozen: buffer via `powerpak/powerpak.properties` o NPC custom **[NO VERIFICADA]** — confirmar qué buffer trae el pack.

---

## 8. Subclass y Noblesse sin quest

### aCis — `config/players.properties` **[VERIFICADA]**
```properties
SubClassWithoutQuests = True   # default False
```

### L2JFrozen — `config/head/altsettings.properties` **[VERIFICADA]**
```properties
AltSubClassWithoutQuests = True   # default False
AllowedSubclass = 3
BaseSubclassLevel = 40            # nivel inicial de la sub al crearla
MaxSubclassLevel = 81
```
Extra (L2JFrozen `config/functions/l2jfrozen.properties`) **[VERIFICADA]**:
```properties
KeepSubClassSkills = False   # True = conserva skills de la sub anterior (roto/divertido; decisión de diseño)
```

### Noblesse sin quest **[NO VERIFICADA en ambos packs]**
- aCis público: no hay key de noblesse en `Config.java`. Requiere quest retail o NPC/script custom (p.ej. Noblesse Manager).
- L2JFrozen: grep sobre `Config.java` no muestra ninguna key NOBLESS. Requiere NPC/script custom en el datapack.
→ La fase de desarrollo debe agregar un NPC "Noblesse Manager" (entrega estado noblesse + tiara) o editar la quest 242/246 según corresponda. Verificar si el datapack descargado ya trae uno.

---

## 9. Teleport gratis, GMShop y NPCs de QoL

### aCis — `config/npcs.properties` **[VERIFICADA]**
```properties
FreeTeleport = True    # GK sin costo para todos (default False)
# Class Master (//spawn 50000): cambio de clase 1ª/2ª/3ª gratis:
ConfigClassMaster = 1;[];[];2;[];[];3;[];[]
AllowEntireTree = False
# Wedding (//spawn 50001): WeddingPrice, WeddingAllowSameSex, WeddingFormalWear
```
- Class Master ya viene con config gratis por defecto en el ejemplo del archivo; con spawnear el NPC 50000 alcanza.
- GMShop: el spawn manager de aCis lista eventos `gmshop`/`gmshop2` como "missing HTMLs" **[VERIFICADA en npcs.properties]** → el GMShop de aCis público está incompleto; la fase de datos debe crear HTMLs/multisell propios o un GMShop custom. **[NO VERIFICADA]** qué multisells trae el datapack.

### L2JFrozen
- GK gratis: buscar `AltGameFreeTeleport` / config de gatekeeper en `functions/l2jfrozen.properties` u `head/altsettings.properties` **[NO VERIFICADA]** — confirmar nombre exacto contra el archivo del pack.
- GMShop/Buffer/GK global suelen vivir en el datapack como NPCs customs (IDs 90000+) o en PowerPack (`config/powerpak/powerpak.properties`) **[NO VERIFICADA]**.

### Voice commands QoL
- L2JFrozen `config/functions/l2jfrozen.properties` **[VERIFICADA]**: `AllowOnlineView = True` (.online), `AllowSimpleStatsView = True` (.stats), `AllowDetailedStatsView = False` (.stat), `AllowVersionCommand`, `AllowFarm1Command`/`AllowFarm2Command`/`AllowPvP1Command`/`AllowPvP2Command` (teleports custom — configurar coordenadas si se usan).
- `.offline_shop` → ver §3.
- aCis público: no trae voice commands custom **[NO VERIFICADA]**; agregar `.menu`/`.offline` como desarrollo propio.

---

## 10. Motor de eventos

### L2JFrozen — `config/frozen/eventmanager.properties` **[VERIFICADA]**
```properties
TVTEventEnabled = True
TVTStartTime = 20:00;
CTFEventEnabled = True
CTFStartTime = 20:30;
DMEventEnabled = True
DMStartTime = 21:00;
# Config por evento en: frozen/tvt.properties, frozen/ctf.properties, frozen/dm.properties, frozen/tw.properties
```
Notas:
- Revisar en cada `frozen/*.properties` las reglas de participación (dualbox en eventos está bloqueado por `AllowDualBoxInEvent = False`, §4).
- Horarios: fijar en hora de Venezuela (UTC-4) pensando en el prime time nocturno.

### aCis público **[VERIFICADA]**
No hay TvT/CTF/DM. `config/events.properties` solo cubre Olympiad, Seven Signs/Festival, Four Sepulchers, Dimension Rift, Lotería y Torneo de Pesca (retail). Si se quiere TvT automático sobre aCis hay que portar un engine (existen shares públicos "TvT for aCis") — decisión de la fase de desarrollo.

---

## 11. Flood protection / paquetes — relajar para que no kickee macros en loop

Los clientes con walker/macro en loop repiten acciones (bypass, multisell, uso de items, macros de chat) a intervalos cortos. Con los defaults de castigo (`kick`) un jugador legítimo con macro en loop termina desconectado.

### aCis — `config/server.properties` **[VERIFICADA]**
Valores en ms; **0 = desactivado**. Defaults razonables pero revisar:
```properties
RollDiceTime = 4200
HeroVoiceTime = 10000
SubclassTime = 2000
DropItemTime = 1000
ServerBypassTime = 100      # walker spamea bypasses de NPC: considerar 0 o mantener bajo
MultisellTime = 100
ManufactureTime = 300
ManorTime = 3000
SendMailTime = 10000
CharacterSelectTime = 3000
GlobalChatTime = 0
TradeChatTime = 0
SocialTime = 2000
```
Nota: aCis solo limita frecuencia (no kickea por flood en el pack público) **[NO VERIFICADA: confirmar que ningún flood protector de la revisión usada aplica kick/ban]**.

### L2JFrozen — `config/protected/flood.properties` **[VERIFICADA]**
Intervalos en ticks (1 tick = 100 ms). Para cada protector: `PunishmentLimit = 0` y/o `PunishmentType = none` desactiva el castigo. **Defaults que kickean y hay que neutralizar**:
```properties
# EL MÁS IMPORTANTE para macros en loop (default: limit 6, kick):
FloodProtectorMacroInterval = 8
FloodProtectorMacroPunishmentLimit = 0
FloodProtectorMacroPunishmentType = none

# Bypass/multisell/transactions (default kick):
FloodProtectorServerBypassPunishmentLimit = 0
FloodProtectorServerBypassPunishmentType = none
FloodProtectorMultiSellPunishmentLimit = 0
FloodProtectorMultiSellPunishmentType = none
FloodProtectorTransactionPunishmentLimit = 0
FloodProtectorTransactionPunishmentType = none
FloodProtectorSubclassPunishmentLimit = 0
FloodProtectorSubclassPunishmentType = none

# Paquetes desconocidos (default limit 3, kick) — redundante si se desactiva
# UnknownPacketProtection en packets.properties, pero dejarlo también en none:
FloodProtectorUnknownPacketsPunishmentLimit = 0
FloodProtectorUnknownPacketsPunishmentType = none

# Chat: mantener ALGO de castigo contra spam publicitario de RMT (default banchat 1 min es OK):
FloodProtectorGlobalChatPunishmentLimit = 2
FloodProtectorGlobalChatPunishmentType = banchat
FloodProtectorSayActionPunishmentLimit = 2
FloodProtectorSayActionPunishmentType = banchat
```
Los demás (`UseItem`, `Potion`, `MoveAction`, `Manufacture`, `DropItem`, `PartyInvitation`…) ya vienen sin castigo en trunk — verificar que sigan así.

### L2JFrozen — `config/network/loginserver.properties` **[VERIFICADA]**
```properties
EnableFloodProtection = True   # flood protection del LOGIN server (conexiones).
# Dejar True (protege contra floods de conexión/DDoS), pero si muchos jugadores
# comparten IP (cafés internet, NAT de ISP venezolanos) revisar también los límites
# de conexiones por IP en este archivo: anti-DDoS / anti-bruteforce.
# [NO VERIFICADA] nombres exactos de esas keys — leer el archivo del pack.
```

---

## 12. Protecciones de spawn/PvP a revisar (bots no mueran por mecánicas anti-afk)

- aCis `config/players.properties` **[VERIFICADA]**: `PlayerSpawnProtection = 0`, `PlayerFakeDeathUpProtection = 5`.
- L2JFrozen `config/head/other.properties` **[VERIFICADA]**: `PlayerSpawnProtection = 0`, `PlayerTeleportProtection = 0`, `PlayerFakeDeathUpProtection = 0`.
- Zonas de paz: aCis `ZoneTown = 0` (paz siempre) **[VERIFICADA]**; L2JFrozen equivalente en `functions/physics.properties` o `head/other.properties` **[NO VERIFICADA]**.
- `MobAggroInPeaceZone` (aCis `npcs.properties`) **[VERIFICADA]**: default True; si hay zonas de farm AFK en paz, evaluar False.

---

## 13. Resumen de cosas NO verificadas (doble-check obligatorio en fase de config)

1. **Offline shops en aCis público**: no existen como config; requieren custom o cambio de pack.
2. **Noblesse sin quest**: no hay key en ninguno de los dos packs; requiere NPC/script.
3. **GMShop en aCis**: eventos `gmshop`/`gmshop2` listados como "missing HTMLs" — crear contenido propio.
4. **TvT/CTF/DM en aCis**: no existen; portar engine si se quieren.
5. **L2JFrozen `SpBookNeeded`/GK gratis/buffer/PowerPack**: nombres exactos de keys no confirmados en esta pasada — leer `head/altsettings.properties`, `functions/l2jfrozen.properties` y `powerpak/powerpak.properties` del pack real.
6. **Captcha/anti-bot de terceros**: si el pack descargado es un fork (muy común en shares de aCis/L2JFrozen "pre-configurados"), grep por `captcha`, `BotProtect`, `antibot`, `walker` en configs y datapack antes de abrir.
7. **Límite visual de buffs del cliente Interlude**: 20+4 sin mod de interfaz; más slots requieren parche de cliente (interface.u / xdat). Confirmar qué muestra el cliente en juego.
8. **Keys de flood/límites por IP en `loginserver.properties` de L2JFrozen** (anti-DDoS/bruteforce): leer el archivo real; importante para IPs compartidas (ISP/cafés en Venezuela).
9. **`AllowNpcWalkers` ≠ L2Walker**: no desactivarlo por error (son NPCs caminantes).
10. Rates sugeridos en §6 son punto de partida de diseño, no verdad absoluta: ajustar tras el primer playtest con jugadores reales.
