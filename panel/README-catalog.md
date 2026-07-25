# Catálogo de configuración — aCis Interlude (rev 409)

`config-catalog.json` es el modelo de datos para el futuro panel web de administración.
Contiene **todas** las claves de configuración de `server/aCis_gameserver/config/*.properties`
(las copias definitivas; las de `build/dist` se generan a partir de estas), con su valor actual,
tipo, categoría, etiquetas en español e inglés, descripción (extraída del comentario inline del
propio archivo) y verificación de que el código realmente la lee.

## Esquema de cada entrada

```json
{
  "file": "server.properties",       // archivo de origen
  "key": "RateXp",                   // clave tal cual aparece en el .properties
  "value": "5.",                     // valor actual (siempre string; usar "type" para parsear)
  "type": "float",                   // int | float | bool | string
  "category": "rates",               // categoría para agrupar en la UI
  "label_en": "XP rate",             // etiqueta humana en inglés
  "label_es": "Tasa de experiencia (XP)", // etiqueta humana en español
  "description": "Rate control, ...",// comentario inline original (inglés), "" si no hay
  "dead": false,                     // true = existe en el archivo pero el código nunca la lee
  "priority": true                   // true = una de las 30 claves de mayor impacto (ver abajo)
}
```

## Totales

- **493 entradas** en total = **354 claves reales** + **139 directivas de región de geodata**.
- **0 claves muertas** (ver sección siguiente).

| Archivo | Entradas | Notas |
|---|---|---|
| `server.properties` | 94 | red, base de datos, rates, features, flood protectors |
| `players.properties` | 82 | jugadores, enchant, augment, karma/PvP, **mods custom (offline trade)** |
| `events.properties` | 55 | olimpiada, seven signs, rift, lotería, pesca |
| `geoengine.properties` | 149 | 10 claves + 139 regiones de geodata |
| `logging.properties` | 44 | config de `java.util.logging` (no la lee `Config.java`, ver abajo) |
| `npcs.properties` | 27 | spawns, class master, buffer, weddings, raids, IA |
| `loginserver.properties` | 18 | red, seguridad, auto-creación de cuentas |
| `clans.properties` | 17 | clanes + manor |
| `siege.properties` | 7 | asedios de castillo y de clan hall |
| `banned_ips.properties` | 0 | archivo vacío; lista de IPs baneadas (la gestiona `IpBanManager`) |

## Claves muertas: ninguna

Cada clave se verificó mecánicamente contra el árbol completo de fuentes Java
(`getProperty("Clave"` / `parseX("Clave"` en `net/sf/l2j/Config.java` y el resto de `java/`).
**Las 354 claves reales son leídas por el código.** Dos matices:

- `logging.properties`: sus 44 claves no aparecen en `Config.java` porque las consume el
  framework `java.util.logging` vía `LogManager.readConfiguration()`
  (`GameServer.java:127`, `LoginServer.java:48`). Están vivas; sus descripciones lo aclaran.
- Las líneas de región de `geoengine.properties` (p. ej. `16_10`, sin `=`) son claves con valor
  vacío que `GeoEngine.java` lee con `containsKey`. Se catalogan como
  `category: "geoengine-regions"`, `type: "bool"` (presencia = cargar la región).

## Las 30 claves de mayor impacto (`priority: true`)

Son las que el panel debería mostrar primero a un dueño de servidor:

**Rates y economía (10)**
`RateXp`, `RateSp`, `RatePartyXp`, `RatePartySp`, `RateDropCurrency` (adena),
`RateDropItems`, `RateRaidDropItems`, `RateDropSpoil`, `RateDropHerbs`, `RateQuestReward`
— todas en `server.properties`.

**Encantamiento y progresión (8)**
`EnchantChanceNonMagicWeapon`, `EnchantChanceMagicWeapon`, `EnchantChanceArmor`,
`EnchantSafeMax`, `EnchantMaxWeapon` (`players.properties`);
`AutoLearnSkills`, `SubClassWithoutQuests` (`players.properties`);
`AllowEntireTree` (`npcs.properties`, class master con árbol completo).

**Población y experiencia de juego (8)**
`MaximumOnlineUsers`, `AutoLoot`, `DeleteCharAfterDays`, `Hostname` (`server.properties`);
`MaxBuffsAmount`, `OfflineTradeEnable` (mod custom de tiendas offline), `DeathPenaltyChance`
(`players.properties`); `FreeTeleport` (`npcs.properties`).

**Mundo y eventos (4)**
`SpawnMultiplier` (`npcs.properties`), `OlyStartTime` (`events.properties`),
`SiegeLength` (`siege.properties`), `AutoCreateAccounts` (`loginserver.properties`).

## Regenerar el catálogo

El catálogo se genera con `panel/.gen_catalog.py` (script de una sola pasada; parsea los
`.properties`, conserva los comentarios inline como descripción, infiere tipos y cruza contra
las fuentes Java). Si se edita algún `.properties` o `Config.java`:

```bash
python3 panel/.gen_catalog.py
```

El script falla a propósito si falta alguna etiqueta ES/EN o si una clave prioritaria desaparece.

## Notas para la UI

- Los valores se exportan como string; parsear según `type` (`bool` acepta `True/False` en los archivos).
- Claves con formato especial que conviene editar con widgets dedicados, no con un textbox:
  `ConfigClassMaster` (sintaxis `1;[items];[premios];2;...`), `AutoDestroySpecialItemTime`
  (`id-segundos,...`), `OlyClassedReward` / `OlyNonClassedReward` (`itemId-cantidad;...`),
  `ListOfPetItems` / `ListOfNonDroppableItemsForPK` (listas de IDs), y las
  `geoengine-regions` (checkbox por región).
- `server.properties` y `loginserver.properties` comparten claves (`Hostname`, `URL`, `Login`,
  `Password`, `LoginPort`) con significados distintos: la UI debe agruparlas por archivo, no por clave.
- Cambios en `UseBlowfishCipher` y en los datos de base de datos requieren reinicio; casi todo lo
  demás también (aCis carga config solo al arrancar).
