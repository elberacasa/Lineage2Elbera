#!/usr/bin/env python3
"""Generates panel/config-catalog.json from server/aCis_gameserver/config/*.properties,
cross-referenced against java/net/sf/l2j/Config.java (and the full java/ tree)."""
import json, os, re, sys

ROOT = "/Users/alejandroberacasa/l2vzla/server/aCis_gameserver"
CFG = os.path.join(ROOT, "config")
OUT = "/Users/alejandroberacasa/l2vzla/panel/config-catalog.json"

# ---------------------------------------------------------------- parsing ---

def parse_properties(path):
    """Return list of (key, value, description) in file order.
    Region directive lines (no '=') in geoengine.properties are returned with
    value '' and flagged via key pattern."""
    entries = []
    comments = []
    with open(path) as f:
        raw = f.read().splitlines()
    i = 0
    pending_value = None  # for line continuations (logging.properties)
    while i < len(raw):
        line = raw[i]
        stripped = line.strip()
        if pending_value is not None:
            # continuation of previous value
            cont = stripped
            if cont.endswith("\\"):
                pending_value += " " + cont[:-1].strip()
                i += 1
                continue
            else:
                pending_value += " " + cont
                entries[-1][1] = pending_value
                pending_value = None
                i += 1
                continue
        if not stripped:
            comments = []
            i += 1
            continue
        if stripped.startswith("#") or stripped.startswith("!"):
            c = stripped.lstrip("#!").strip()
            # skip decorative banners and commented-out key=value examples
            if re.match(r"^[=\-_* ]{3,}$", c):
                comments = []
            elif re.match(r"^\S+\s*[=:]", c):
                pass  # commented-out property example: skip
            elif c:
                comments.append(c)
            i += 1
            continue
        m = re.match(r"^([^=\s:]+)\s*[=:]\s*(.*)$", stripped)
        if m:
            key, val = m.group(1).strip(), m.group(2).strip()
            if val.endswith("\\"):
                pending_value = val[:-1].strip()
            entries.append([key, val, " ".join(comments)])
            comments = []
        else:
            # region directive (geoengine) — key with empty value
            entries.append([stripped, "", " ".join(comments)])
            comments = []
        i += 1
    return entries

def infer_type(val):
    v = val.strip()
    if v.lower() in ("true", "false"):
        return "bool"
    if re.match(r"^[+-]?\d+$", v):
        return "int"
    if re.match(r"^[+-]?(\d+\.\d*|\.\d+)$", v):
        return "float"
    return "string"

# ---------------------------------------------------------------- labels ----
# (file, key) -> (category, label_en, label_es)

L = {}

def add(fname, cat, mapping):
    for key, (en, es) in mapping.items():
        L[(fname, key)] = (cat, en, es)

add("server.properties", "network", {
 "Hostname": ("Public hostname / IP sent to clients", "Hostname público / IP enviada a los clientes"),
 "GameserverHostname": ("Gameserver bind IP", "IP de escucha del gameserver"),
 "GameserverPort": ("Gameserver port", "Puerto del gameserver"),
 "LoginHost": ("Loginserver host", "Host del loginserver"),
 "LoginPort": ("Loginserver port", "Puerto del loginserver"),
 "RequestServerID": ("Requested server ID", "ID de servidor solicitado"),
 "AcceptAlternateID": ("Accept alternate server ID", "Aceptar ID de servidor alternativo"),
 "UseBlowfishCipher": ("Encrypt packets with Blowfish", "Cifrar paquetes con Blowfish"),
})
add("server.properties", "database", {
 "URL": ("Database JDBC URL", "URL JDBC de la base de datos"),
 "Login": ("Database user", "Usuario de la base de datos"),
 "Password": ("Database password", "Contraseña de la base de datos"),
})
add("server.properties", "server-list", {
 "ServerListBrackets": ("Show brackets around server name", "Mostrar corchetes en el nombre del servidor"),
 "ServerListClock": ("Show clock next to server name", "Mostrar reloj junto al nombre del servidor"),
 "ServerListAgeLimit": ("Server list age limit", "Límite de antigüedad en la lista de servidores"),
 "ServerGMOnly": ("GM-only server", "Servidor solo para GMs"),
 "TestServer": ("Test server mode", "Modo servidor de pruebas"),
 "PvpServer": ("Listed as PvP server", "Listado como servidor PvP"),
})
add("server.properties", "players", {
 "DeleteCharAfterDays": ("Days before character can be deleted (0 = disabled)", "Días para poder borrar un personaje (0 = desactivado)"),
 "MaximumOnlineUsers": ("Maximum online players", "Máximo de jugadores en línea"),
})
add("server.properties", "gameplay", {
 "AutoLoot": ("Auto-loot drops", "Recogida automática de drops"),
 "AutoLootRaid": ("Auto-loot raid boss drops", "Recogida automática de drops de raids"),
 "AutoLootHerbs": ("Auto-loot herbs", "Recogida automática de hierbas"),
})
add("server.properties", "items", {
 "AllowDiscardItem": ("Allow dropping items on the ground", "Permitir tirar objetos al suelo"),
 "MultipleItemDrop": ("Allow dropping multiple non-stackable items", "Permitir tirar varios objetos no apilables"),
 "AutoDestroyHerbTime": ("Destroy dropped herbs after (s, 0 = never)", "Destruir hierbas tiradas tras (s, 0 = nunca)"),
 "AutoDestroyItemTime": ("Destroy dropped items after (s, 0 = never)", "Destruir objetos tirados tras (s, 0 = nunca)"),
 "AutoDestroyEquipableItemTime": ("Destroy dropped equipment after (s, 0 = never)", "Destruir equipamiento tirado tras (s, 0 = nunca)"),
 "AutoDestroySpecialItemTime": ("Per-item destroy times (id-seconds,...)", "Tiempos de destrucción por objeto (id-segundos,...)"),
 "PlayerDroppedItemMultiplier": ("Destroy-time multiplier for player drops", "Multiplicador de destrucción para drops de jugadores"),
})
_rates = {
 "RateXp": ("XP rate", "Tasa de experiencia (XP)"),
 "RateSp": ("SP rate", "Tasa de SP"),
 "RatePartyXp": ("Party XP rate", "Tasa de XP en party"),
 "RatePartySp": ("Party SP rate", "Tasa de SP en party"),
 "RateDropCurrency": ("Adena / seal stone drop rate", "Tasa de drop de adena / seal stones"),
 "RateDropItems": ("Item drop rate", "Tasa de drop de objetos"),
 "RateRaidDropItems": ("Raid boss drop rate", "Tasa de drop de raid bosses"),
 "RateDropSpoil": ("Spoil rate", "Tasa de spoil"),
 "RateDropHerbs": ("Herb drop rate", "Tasa de drop de hierbas"),
 "RateDropManor": ("Manor (seed) drop rate", "Tasa de drop de manor (semillas)"),
 "RateQuestDrop": ("Quest item drop rate", "Tasa de drop de objetos de quest"),
 "RateQuestReward": ("Quest reward rate", "Tasa de recompensas de quest"),
 "RateQuestRewardXP": ("Quest XP reward rate", "Tasa de XP de recompensa de quest"),
 "RateQuestRewardSP": ("Quest SP reward rate", "Tasa de SP de recompensa de quest"),
 "RateQuestRewardAdena": ("Quest adena reward rate", "Tasa de adena de recompensa de quest"),
 "RateKarmaExpLost": ("Karma XP loss rate", "Tasa de pérdida de XP con karma"),
 "RateSiegeGuardsPrice": ("Siege guards price rate", "Tasa de precio de guardias de asedio"),
 "PlayerDropLimit": ("Max dropped items on death (%)", "Máx. objetos soltados al morir (%)"),
 "PlayerRateDrop": ("Chance to drop anything on death (%)", "Prob. de soltar algo al morir (%)"),
 "PlayerRateDropItem": ("Chance to drop inventory items (%)", "Prob. de soltar objetos del inventario (%)"),
 "PlayerRateDropEquip": ("Chance to drop equipped items (%)", "Prob. de soltar equipamiento (%)"),
 "PlayerRateDropEquipWeapon": ("Chance to drop equipped weapon (%)", "Prob. de soltar el arma equipada (%)"),
 "KarmaDropLimit": ("Karma drop limit (%)", "Límite de drop con karma (%)"),
 "KarmaRateDrop": ("Karma drop chance (%)", "Prob. de drop con karma (%)"),
 "KarmaRateDropItem": ("Karma item drop chance (%)", "Prob. de soltar objetos con karma (%)"),
 "KarmaRateDropEquip": ("Karma equipment drop chance (%)", "Prob. de soltar equipamiento con karma (%)"),
 "KarmaRateDropEquipWeapon": ("Karma weapon drop chance (%)", "Prob. de soltar el arma con karma (%)"),
 "PetXpRate": ("Pet XP rate", "Tasa de XP de mascotas"),
 "PetFoodRate": ("Pet food consumption rate", "Tasa de consumo de comida de mascotas"),
 "SinEaterXpRate": ("Sin Eater XP rate", "Tasa de XP del Sin Eater"),
}
add("server.properties", "rates", _rates)
add("server.properties", "features", {
 "AllowFreight": ("Enable freight system", "Habilitar sistema de freight (envíos)"),
 "AllowWarehouse": ("Enable warehouse", "Habilitar almacén"),
 "AllowWear": ("Allow trying on items in shops", "Permitir probarse objetos en tiendas"),
 "WearDelay": ("Try-on duration", "Duración de la prueba de objetos"),
 "WearPrice": ("Try-on price (adena)", "Precio de probarse objetos (adena)"),
 "AllowLottery": ("Enable lottery", "Habilitar lotería"),
 "AllowWater": ("Enable water zones", "Habilitar zonas de agua"),
 "AllowCursedWeapons": ("Enable cursed weapons", "Habilitar armas malditas"),
 "AllowManor": ("Enable manor system", "Habilitar sistema de manor"),
 "AllowBoat": ("Enable boats", "Habilitar barcos"),
 "EnableFallingDamage": ("Enable fall damage", "Habilitar daño por caída"),
})
add("server.properties", "debug", {
 "NoSpawns": ("Skip loading spawns (debug)", "No cargar spawns (depuración)"),
 "Developer": ("Developer debug messages", "Mensajes de depuración de desarrollador"),
 "PacketHandlerDebug": ("Packet handler debug", "Depuración del manejador de paquetes"),
})
add("server.properties", "logging", {
 "LogChat": ("Log chat to file", "Registrar chat en archivo"),
 "LogItems": ("Log item transactions (heavy disk use)", "Registrar movimientos de objetos (uso alto de disco)"),
 "GMAudit": ("Log GM actions", "Registrar acciones de GM"),
})
add("server.properties", "community", {
 "EnableCommunityBoard": ("Enable community board", "Habilitar community board"),
 "BBSDefault": ("Default community board page", "Página inicial del community board"),
})
_flood = {
 "RollDiceTime": ("Roll dice delay (ms)", "Retardo de dados (ms)"),
 "HeroVoiceTime": ("Hero voice delay (ms)", "Retardo de voz de héroe (ms)"),
 "SubclassTime": ("Subclass change delay (ms)", "Retardo de cambio de subclase (ms)"),
 "DropItemTime": ("Drop item delay (ms)", "Retardo al tirar objetos (ms)"),
 "ServerBypassTime": ("Bypass delay (ms)", "Retardo de bypass (ms)"),
 "MultisellTime": ("Multisell delay (ms)", "Retardo de multisell (ms)"),
 "ManufactureTime": ("Manufacture list delay (ms)", "Retardo de lista de manufactura (ms)"),
 "ManorTime": ("Manor action delay (ms)", "Retardo de acciones de manor (ms)"),
 "SendMailTime": ("Send mail delay (ms)", "Retardo al enviar correo (ms)"),
 "CharacterSelectTime": ("Character select delay (ms)", "Retardo de selección de personaje (ms)"),
 "GlobalChatTime": ("Global chat delay (ms)", "Retardo de chat global (ms)"),
 "TradeChatTime": ("Trade chat delay (ms)", "Retardo de chat de comercio (ms)"),
 "SocialTime": ("Social action delay (ms)", "Retardo de acciones sociales (ms)"),
}
add("server.properties", "flood-protection", _flood)
add("server.properties", "misc", {
 "L2WalkerProtection": ("Basic L2Walker bot protection", "Protección básica contra el bot L2Walker"),
 "ZoneTown": ("Town zone PvP mode (0 peace, 1 siege, 2 PvP)", "Modo PvP de ciudades (0 paz, 1 asedio, 2 PvP)"),
 "ShowServerNews": ("Show server news on login", "Mostrar noticias del servidor al entrar"),
})

# ---- players.properties
add("players.properties", "players", {
 "CancelLesserEffect": ("Cancel lesser stacked buffs", "Cancelar buffs apilados de menor nivel"),
 "HpRegenMultiplier": ("HP regen multiplier", "Multiplicador de regeneración de HP"),
 "MpRegenMultiplier": ("MP regen multiplier", "Multiplicador de regeneración de MP"),
 "CpRegenMultiplier": ("CP regen multiplier", "Multiplicador de regeneración de CP"),
 "PlayerSpawnProtection": ("Spawn/login protection (s, 0 = off)", "Protección al aparecer/entrar (s, 0 = off)"),
 "PlayerFakeDeathUpProtection": ("Protection after fake death (s)", "Protección tras levantarse de falsa muerte (s)"),
 "RespawnRestoreHP": ("HP restored on revive (1 = 100%)", "HP restaurado al revivir (1 = 100%)"),
 "MaxPvtStoreSlotsDwarf": ("Private store slots (dwarves)", "Espacios de tienda privada (enanos)"),
 "MaxPvtStoreSlotsOther": ("Private store slots (other races)", "Espacios de tienda privada (otras razas)"),
 "UseDeepBlueDropRules": ("Deep blue mob drop penalties", "Penalizaciones de drop en mobs azul oscuro"),
 "AllowDelevel": ("Allow losing levels on death", "Permitir bajar de nivel al morir"),
 "DeathPenaltyChance": ("Death penalty chance (%)", "Probabilidad de penalización al morir (%)"),
})
add("players.properties", "custom-mods", {
 "OfflineTradeEnable": ("Offline private stores (custom mod)", "Tiendas privadas offline (mod custom)"),
 "OfflineCraftEnable": ("Offline craft stores (custom mod)", "Tiendas de manufactura offline (mod custom)"),
 "OfflineRestoreOnLogin": ("Recycle offline trader on login (custom mod)", "Reciclar vendedor offline al entrar (mod custom)"),
})
add("players.properties", "inventory", {
 "MaximumSlotsForNoDwarf": ("Inventory slots (non-dwarf)", "Espacios de inventario (no enano)"),
 "MaximumSlotsForDwarf": ("Inventory slots (dwarf)", "Espacios de inventario (enano)"),
 "MaximumSlotsForPet": ("Pet inventory slots", "Espacios de inventario de mascota"),
 "WeightLimit": ("Weight limit multiplier", "Multiplicador de límite de peso"),
 "MaximumWarehouseSlotsForDwarf": ("Warehouse slots (dwarf)", "Espacios de almacén (enano)"),
 "MaximumWarehouseSlotsForNoDwarf": ("Warehouse slots (non-dwarf)", "Espacios de almacén (no enano)"),
 "MaximumWarehouseSlotsForClan": ("Clan warehouse slots", "Espacios de almacén de clan"),
 "MaximumFreightSlots": ("Freight slots", "Espacios de freight"),
 "RegionBasedFreight": ("Region-bound freight", "Freight limitado por región"),
 "FreightPrice": ("Freight price per slot (adena)", "Precio de freight por espacio (adena)"),
})
add("players.properties", "enchant", {
 "EnchantChanceMagicWeapon": ("Enchant chance: magic weapon", "Prob. de encantar: arma mágica"),
 "EnchantChanceMagicWeapon15Plus": ("Enchant chance: magic weapon +15 and up", "Prob. de encantar: arma mágica +15 en adelante"),
 "EnchantChanceNonMagicWeapon": ("Enchant chance: physical weapon", "Prob. de encantar: arma física"),
 "EnchantChanceNonMagicWeapon15Plus": ("Enchant chance: physical weapon +15 and up", "Prob. de encantar: arma física +15 en adelante"),
 "EnchantChanceArmor": ("Enchant chance: armor / jewelry", "Prob. de encantar: armadura / joyas"),
 "EnchantMaxWeapon": ("Max weapon enchant (0 = unlimited)", "Encantamiento máx. de arma (0 = sin límite)"),
 "EnchantMaxArmor": ("Max armor enchant (0 = unlimited)", "Encantamiento máx. de armadura (0 = sin límite)"),
 "EnchantSafeMax": ("Safe enchant limit", "Límite de encantamiento seguro"),
 "EnchantSafeMaxFull": ("Safe enchant limit (full-body armor)", "Límite de encantamiento seguro (armadura de cuerpo completo)"),
})
_aug = {}
for grade, g_es in [("NG", "sin grado"), ("Mid", "grado medio"), ("High", "grado alto"), ("Top", "grado superior")]:
    _aug[f"Augmentation{grade}SkillChance"] = (f"Augment skill chance ({grade} life stone)", f"Prob. de skill en aumento (piedra {g_es})")
    _aug[f"Augmentation{grade}GlowChance"] = (f"Augment glow chance ({grade} life stone)", f"Prob. de brillo en aumento (piedra {g_es})")
_aug["AugmentationBaseStatChance"] = ("Augment base stat chance", "Prob. de stat base en aumento")
add("players.properties", "augmentation", _aug)
add("players.properties", "karma-pvp", {
 "KarmaPlayerCanShop": ("PK players can use shops", "Jugadores PK pueden usar tiendas"),
 "KarmaPlayerCanTeleport": ("PK players can teleport", "Jugadores PK pueden teleportarse"),
 "KarmaPlayerCanUseGK": ("PK players can use gatekeepers", "Jugadores PK pueden usar gatekeepers"),
 "KarmaPlayerCanTrade": ("PK players can trade", "Jugadores PK pueden comerciar"),
 "KarmaPlayerCanUseWareHouse": ("PK players can use warehouse", "Jugadores PK pueden usar el almacén"),
 "CanGMDropEquipment": ("GMs can drop equipment on death", "Los GMs pueden soltar equipamiento al morir"),
 "ListOfPetItems": ("Pet items that can never drop", "Objetos de mascota que nunca se sueltan"),
 "ListOfNonDroppableItemsForPK": ("Items a PK can never drop", "Objetos que un PK nunca suelta"),
 "MinimumPKRequiredToDrop": ("Min PK count before dropping items", "Mínimo de PKs para soltar objetos"),
 "AwardPKKillPVPPoint": ("PvP point for killing a PK player", "Punto PvP por matar a un jugador PK"),
 "PvPVsNormalTime": ("PvP flag after hitting innocent (ms)", "Flag PvP tras golpear a un inocente (ms)"),
 "PvPVsPvPTime": ("PvP flag after hitting flagged player (ms)", "Flag PvP tras golpear a un jugador con flag (ms)"),
})
add("players.properties", "party", {
 "PartyXpCutoffMethod": ("Party XP cutoff method", "Método de corte de XP en party"),
 "PartyXpCutoffPercent": ("Party XP cutoff percent", "Porcentaje de corte de XP en party"),
 "PartyXpCutoffLevel": ("Party XP cutoff level difference", "Diferencia de nivel de corte de XP en party"),
 "PartyRange": ("Party range", "Rango de party"),
})
add("players.properties", "gm-admin", {
 "DefaultAccessLevel": ("Default access level for all users", "Nivel de acceso por defecto de todos los usuarios"),
 "GMHeroAura": ("GMs get hero aura", "Los GMs tienen aura de héroe"),
 "GMStartupInvulnerable": ("GM invulnerable on login", "GM invulnerable al entrar"),
 "GMStartupInvisible": ("GM invisible on login", "GM invisible al entrar"),
 "GMStartupBlockAll": ("GM blocks private messages on login", "GM bloquea mensajes privados al entrar"),
 "GMStartupAutoList": ("GM listed in /gmlist on login", "GM listado en /gmlist al entrar"),
})
add("players.properties", "petitions", {
 "PetitioningAllowed": ("Enable in-game petitions", "Habilitar peticiones en el juego"),
 "MaxPetitionsPerPlayer": ("Max petitions per player/session", "Máx. peticiones por jugador/sesión"),
 "MaxPetitionsPending": ("Max pending petitions", "Máx. peticiones pendientes"),
})
add("players.properties", "crafting", {
 "CraftingEnabled": ("Enable crafting", "Habilitar crafteo"),
 "DwarfRecipeLimit": ("Recipe limit (dwarves)", "Límite de recetas (enanos)"),
 "CommonRecipeLimit": ("Recipe limit (other races)", "Límite de recetas (otras razas)"),
 "BlacksmithUseRecipes": ("Blacksmith consumes recipes", "El herrero consume recetas"),
})
add("players.properties", "skills-classes", {
 "AutoLearnSkills": ("Auto-learn skills on level up", "Aprender skills automáticamente al subir de nivel"),
 "MagicFailures": ("Enable magic failures", "Habilitar fallos de magia"),
 "PerfectShieldBlockRate": ("Perfect shield block rate", "Tasa de bloqueo perfecto con escudo"),
 "LifeCrystalNeeded": ("Life crystal needed for clan skills", "Cristal de vida requerido para skills de clan"),
 "SpBookNeeded": ("Spellbook needed to learn skills", "Spellbook requerido para aprender skills"),
 "EnchantSkillSpBookNeeded": ("Giant book needed to enchant skills", "Libro gigante requerido para encantar skills"),
 "DivineInspirationSpBookNeeded": ("Spellbook needed for Divine Inspiration", "Spellbook requerido para Divine Inspiration"),
 "SubClassWithoutQuests": ("Subclass without quests", "Subclase sin hacer quests"),
})
add("players.properties", "buffs", {
 "MaxBuffsAmount": ("Max buff slots", "Máximo de espacios de buffs"),
 "StoreSkillCooltime": ("Keep buffs/cooldowns on logout", "Conservar buffs/cooldowns al salir"),
})

# ---- npcs.properties
add("npcs.properties", "spawns", {
 "SpawnMultiplier": ("Spawn count multiplier", "Multiplicador de cantidad de spawns"),
 "SpawnEvents": ("NPC events spawned at startup", "Eventos de NPC spawneados al iniciar"),
})
add("npcs.properties", "class-master", {
 "AllowEntireTree": ("Class master allows full class tree", "Class master permite todo el árbol de clases"),
 "ConfigClassMaster": ("Class master occupation change config", "Configuración de cambios de clase del class master"),
})
add("npcs.properties", "wedding", {
 "WeddingPrice": ("Wedding price (adena)", "Precio de boda (adena)"),
 "WeddingAllowSameSex": ("Allow same-sex marriage", "Permitir matrimonio del mismo sexo"),
 "WeddingFormalWear": ("Formal wear required for wedding", "Traje formal requerido para la boda"),
})
add("npcs.properties", "buffer", {
 "BufferMaxSchemesPerChar": ("Max buff schemes per character", "Máx. esquemas de buffs por personaje"),
 "BufferStaticCostPerBuff": ("Static cost per buff (-1 = skill price)", "Costo fijo por buff (-1 = precio del skill)"),
})
add("npcs.properties", "npcs", {
 "FreeTeleport": ("Free teleports for all players", "Teleportes gratis para todos los jugadores"),
 "MobAggroInPeaceZone": ("Mobs aggro inside peace zones", "Mobs agresivos dentro de zonas de paz"),
 "ShowNpcLevel": ("Show monster level and aggro", "Mostrar nivel y aggro de los monstruos"),
 "ShowNpcCrest": ("Show clan crests on NPCs", "Mostrar emblemas de clan en NPCs"),
 "ShowSummonCrest": ("Show clan crests on summons", "Mostrar emblemas de clan en summons"),
})
add("npcs.properties", "wyvern", {
 "RequiredStriderLevel": ("Min strider level for wyvern", "Nivel mín. de strider para wyvern"),
 "RequiredCrystalsNumber": ("B-crystals needed for wyvern", "Cristales B necesarios para wyvern"),
})
add("npcs.properties", "raid-bosses", {
 "RaidHpRegenMultiplier": ("Raid HP regen multiplier", "Multiplicador de regen de HP de raids"),
 "RaidMpRegenMultiplier": ("Raid MP regen multiplier", "Multiplicador de regen de MP de raids"),
 "RaidDefenceMultiplier": ("Raid defence multiplier", "Multiplicador de defensa de raids"),
 "DisableRaidCurse": ("Disable raid level curse", "Desactivar maldición de nivel de raid"),
})
add("npcs.properties", "grand-bosses", {
 "AntharasWaitTime": ("Antharas appearance delay (min)", "Demora de aparición de Antharas (min)"),
 "ValakasWaitTime": ("Valakas appearance delay (min)", "Demora de aparición de Valakas (min)"),
 "FrintezzaWaitTime": ("Frintezza appearance delay (min)", "Demora de aparición de Frintezza (min)"),
})
add("npcs.properties", "ai", {
 "GuardAttackAggroMob": ("Guards attack aggressive monsters", "Los guardias atacan monstruos agresivos"),
 "RandomWalkRate": ("Random walk rate (%)", "Tasa de caminata aleatoria (%)"),
 "MaxDriftRange": ("Max drift range from spawn point", "Rango máx. de alejamiento del spawn"),
 "DefaultSeeRange": ("NPC default sight range", "Rango de visión por defecto de NPCs"),
})

# ---- events.properties
add("events.properties", "olympiad", {
 "OlyStartTime": ("Olympiad start hour", "Hora de inicio de la Olimpiada"),
 "OlyMin": ("Olympiad start minute", "Minuto de inicio de la Olimpiada"),
 "OlyCPeriod": ("Olympiad competition period (ms)", "Período de competencia olímpica (ms)"),
 "OlyBattle": ("Olympiad battle duration (ms)", "Duración de batalla olímpica (ms)"),
 "OlyWaitTime": ("Wait before arena teleport (s)", "Espera antes del teleport a la arena (s)"),
 "OlyWaitBattle": ("Wait before battle starts (s)", "Espera antes de iniciar el combate (s)"),
 "OlyWaitEnd": ("Wait before teleport back (s)", "Espera antes del teleport de regreso (s)"),
 "OlyStartPoints": ("Initial olympiad points", "Puntos olímpicos iniciales"),
 "OlyWeeklyPoints": ("Weekly olympiad points", "Puntos olímpicos semanales"),
 "OlyMinMatchesToBeClassed": ("Min matches to become hero-ranked", "Mín. de combates para clasificar a héroe"),
 "OlyClassedParticipants": ("Min participants (class-based)", "Mín. participantes (combates por clase)"),
 "OlyNonClassedParticipants": ("Min participants (non-classed)", "Mín. participantes (combates sin clase)"),
 "OlyClassedReward": ("Reward for class-based games", "Recompensa de combates por clase"),
 "OlyNonClassedReward": ("Reward for non-classed games", "Recompensa de combates sin clase"),
 "OlyGPPerPoint": ("Gate passes per olympiad point", "Gate passes por punto olímpico"),
 "OlyHeroPoints": ("Clan reputation points for heroes", "Puntos de reputación de clan para héroes"),
 "OlyMaxPoints": ("Max points won/lost per match", "Máx. puntos ganados/perdidos por combate"),
 "OlyAnnounceGames": ("Announce olympiad matches", "Anunciar combates olímpicos"),
 "OlyDividerClassed": ("Point divider (classed)", "Divisor de puntos (por clase)"),
 "OlyDividerNonClassed": ("Point divider (non-classed)", "Divisor de puntos (sin clase)"),
})
add("events.properties", "seven-signs", {
 "SevenSignsBypassPrerequisites": ("Bypass Seven Signs prerequisites", "Omitir prerrequisitos de Seven Signs"),
 "FestivalMinPlayer": ("Min players for the festival", "Mín. de jugadores para el festival"),
 "MaxPlayerContrib": ("Max contribution per player", "Contribución máx. por jugador"),
 "FestivalManagerStart": ("Festival manager start time (ms)", "Inicio del festival (ms)"),
 "FestivalLength": ("Festival length (ms)", "Duración del festival (ms)"),
 "FestivalCycleLength": ("Festival cycle length (ms)", "Duración del ciclo del festival (ms)"),
 "FestivalFirstSpawn": ("First spawn at (ms)", "Primer spawn a los (ms)"),
 "FestivalFirstSwarm": ("First swarm at (ms)", "Primera oleada a los (ms)"),
 "FestivalSecondSpawn": ("Second spawn at (ms)", "Segundo spawn a los (ms)"),
 "FestivalSecondSwarm": ("Second swarm at (ms)", "Segunda oleada a los (ms)"),
 "FestivalChestSpawn": ("Chest spawn at (ms)", "Aparición de cofres a los (ms)"),
})
add("events.properties", "four-sepulchers", {
 "NeededPartyMembers": ("Party members required to enter", "Miembros de party requeridos para entrar"),
})
add("events.properties", "dimension-rift", {
 "RiftMinPartySize": ("Min party size to enter rift", "Tamaño mín. de party para entrar al Rift"),
 "AutoJumpsDelayMin": ("Auto-jump delay (min)", "Retardo de salto automático (min)"),
 "AutoJumpsDelayRnd": ("Random jump interval count (30s each)", "Intervalos aleatorios de salto (30s c/u)"),
 "RecruitCost": ("Entry cost: Recruit (fragments)", "Costo de entrada: Recruit (fragmentos)"),
 "SoldierCost": ("Entry cost: Soldier (fragments)", "Costo de entrada: Soldier (fragmentos)"),
 "OfficerCost": ("Entry cost: Officer (fragments)", "Costo de entrada: Officer (fragmentos)"),
 "CaptainCost": ("Entry cost: Captain (fragments)", "Costo de entrada: Captain (fragmentos)"),
 "CommanderCost": ("Entry cost: Commander (fragments)", "Costo de entrada: Commander (fragmentos)"),
 "HeroCost": ("Entry cost: Hero (fragments)", "Costo de entrada: Hero (fragmentos)"),
 "AnakazelPortChance": ("Anakazel teleport chance (%)", "Prob. de teleport a Anakazel (%)"),
})
add("events.properties", "lottery", {
 "LotteryPrize": ("Initial lottery jackpot", "Pozo inicial de la lotería"),
 "LotteryTicketPrice": ("Lottery ticket price", "Precio del boleto de lotería"),
 "Lottery5NumberRate": ("Jackpot share for 5 hits", "Parte del pozo por 5 aciertos"),
 "Lottery4NumberRate": ("Jackpot share for 4 hits", "Parte del pozo por 4 aciertos"),
 "Lottery3NumberRate": ("Jackpot share for 3 hits", "Parte del pozo por 3 aciertos"),
 "Lottery2and1NumberPrize": ("Prize for 2 hits or fewer (adena)", "Premio por 2 aciertos o menos (adena)"),
})
add("events.properties", "fishing", {
 "AllowFishChampionship": ("Enable fishing tournament", "Habilitar torneo de pesca"),
 "FishChampionshipRewardItemId": ("Reward item ID", "ID del objeto de recompensa"),
 "FishChampionshipReward1": ("1st place reward", "Premio del 1er puesto"),
 "FishChampionshipReward2": ("2nd place reward", "Premio del 2do puesto"),
 "FishChampionshipReward3": ("3rd place reward", "Premio del 3er puesto"),
 "FishChampionshipReward4": ("4th place reward", "Premio del 4to puesto"),
 "FishChampionshipReward5": ("5th place reward", "Premio del 5to puesto"),
})

# ---- clans.properties
add("clans.properties", "clans", {
 "DaysBeforeJoinAClan": ("Days before joining another clan", "Días para unirse a otro clan"),
 "DaysBeforeCreateAClan": ("Days before creating a new clan", "Días para crear un clan nuevo"),
 "DaysToPassToDissolveAClan": ("Days to dissolve a clan", "Días para disolver un clan"),
 "DaysBeforeJoinAllyWhenLeaved": ("Days to join an alliance (after leaving)", "Días para unirse a una alianza (tras salir)"),
 "DaysBeforeJoinAllyWhenDismissed": ("Days to join an alliance (after dismissal)", "Días para unirse a una alianza (tras expulsión)"),
 "DaysBeforeAcceptNewClanWhenDismissed": ("Days to accept a new clan (after dismissal)", "Días para aceptar un clan nuevo (tras expulsión)"),
 "DaysBeforeCreateNewAllyWhenDissolved": ("Days to create a new alliance (after dissolving)", "Días para crear una alianza nueva (tras disolver)"),
 "MaxNumOfClansInAlly": ("Max clans per alliance", "Máx. clanes por alianza"),
 "ClanMembersForWar": ("Members needed to declare clan war", "Miembros necesarios para declarar guerra de clan"),
 "ClanWarPenaltyWhenEnded": ("War cooldown when ended (days)", "Enfriamiento de guerra al terminar (días)"),
 "MembersCanWithdrawFromClanWH": ("Members can withdraw from clan warehouse", "Miembros pueden retirar del almacén de clan"),
})
add("clans.properties", "manor", {
 "ManorRefreshTime": ("Manor refresh hour", "Hora de actualización del manor"),
 "ManorRefreshMin": ("Manor refresh minute", "Minuto de actualización del manor"),
 "ManorApproveTime": ("Manor approve hour", "Hora de aprobación del manor"),
 "ManorApproveMin": ("Manor approve minute", "Minuto de aprobación del manor"),
 "ManorMaintenanceMin": ("Manor maintenance duration (min)", "Duración del mantenimiento del manor (min)"),
 "ManorSavePeriodRate": ("Manor save period (hours)", "Período de guardado del manor (horas)"),
})

# ---- loginserver.properties
add("loginserver.properties", "network", {
 "Hostname": ("Public hostname / IP sent to clients", "Hostname público / IP enviada a los clientes"),
 "LoginserverHostname": ("Loginserver bind IP (clients)", "IP de escucha del loginserver (clientes)"),
 "LoginserverPort": ("Loginserver client port", "Puerto de clientes del loginserver"),
 "LoginHostname": ("Loginserver bind IP (gameservers)", "IP de escucha del loginserver (gameservers)"),
 "LoginPort": ("Port for gameserver connections", "Puerto para conexiones de gameservers"),
})
add("loginserver.properties", "login", {
 "LoginTryBeforeBan": ("Failed logins before IP ban", "Logins fallidos antes de ban de IP"),
 "LoginBlockAfterBan": ("IP ban duration (s)", "Duración del ban de IP (s)"),
 "AcceptNewGameServer": ("Accept any gameserver registration", "Aceptar registro de cualquier gameserver"),
 "ShowLicence": ("Show licence screen after login", "Mostrar pantalla de licencia tras login"),
 "AutoCreateAccounts": ("Auto-create accounts on first login", "Crear cuentas automáticamente en el primer login"),
})
add("loginserver.properties", "database", {
 "URL": ("Database JDBC URL", "URL JDBC de la base de datos"),
 "Login": ("Database user", "Usuario de la base de datos"),
 "Password": ("Database password", "Contraseña de la base de datos"),
})
add("loginserver.properties", "security", {
 "EnableFloodProtection": ("Enable connection flood protection", "Habilitar protección anti-flood de conexiones"),
 "FastConnectionLimit": ("Fast connections before throttle", "Conexiones rápidas antes de limitar"),
 "NormalConnectionTime": ("Normal min time between connections (ms)", "Tiempo mín. normal entre conexiones (ms)"),
 "FastConnectionTime": ("Fast min time between connections (ms)", "Tiempo mín. rápido entre conexiones (ms)"),
 "MaxConnectionPerIP": ("Max simultaneous connections per IP", "Máx. conexiones simultáneas por IP"),
})

# ---- siege.properties
add("siege.properties", "siege", {
 "SiegeLength": ("Siege duration (min)", "Duración del asedio (min)"),
 "SiegeClanMinLevel": ("Min clan level to register", "Nivel mín. de clan para registrarse"),
 "AttackerMaxClans": ("Max attacker clans", "Máx. clanes atacantes"),
 "DefenderMaxClans": ("Max defender clans", "Máx. clanes defensores"),
 "AttackerRespawn": ("Attacker respawn delay (ms)", "Retardo de respawn de atacantes (ms)"),
})
add("siege.properties", "clan-hall-siege", {
 "ChSiegeClanMinLevel": ("Min clan level (clan hall siege)", "Nivel mín. de clan (asedio de clan hall)"),
 "ChAttackerMaxClans": ("Max clans (clan hall siege)", "Máx. clanes (asedio de clan hall)"),
})

# ---- geoengine.properties
add("geoengine.properties", "geoengine", {
 "GeoDataPath": ("Geodata files path", "Ruta de los archivos de geodata"),
 "GeoDataType": ("Geodata file type (L2J / L2OFF)", "Tipo de archivo de geodata (L2J / L2OFF)"),
 "MaxGeopathFailCount": ("Max geopath fails before warning", "Máx. fallos de geopath antes de avisar"),
 "PartOfCharacterHeight": ("Line-of-sight start (% of char height)", "Inicio de línea de visión (% de la altura)"),
 "MaxObstacleHeight": ("Max obstacle height for line of sight", "Altura máx. de obstáculo para línea de visión"),
 "MoveWeight": ("Pathfinding axial move weight", "Peso de movimiento axial del pathfinding"),
 "MoveWeightDiag": ("Pathfinding diagonal move weight", "Peso de movimiento diagonal del pathfinding"),
 "ObstacleWeight": ("Pathfinding obstacle weight", "Peso de obstáculo del pathfinding"),
 "HeuristicWeight": ("Pathfinding heuristic weight", "Peso heurístico del pathfinding"),
 "MaxIterations": ("Max pathfinding iterations", "Máx. iteraciones del pathfinding"),
})

# ---- 30 highest-impact keys for the UI (file, key)
PRIORITY = {
 ("server.properties","RateXp"), ("server.properties","RateSp"),
 ("server.properties","RatePartyXp"), ("server.properties","RatePartySp"),
 ("server.properties","RateDropCurrency"), ("server.properties","RateDropItems"),
 ("server.properties","RateRaidDropItems"), ("server.properties","RateDropSpoil"),
 ("server.properties","RateDropHerbs"), ("server.properties","RateQuestReward"),
 ("server.properties","MaximumOnlineUsers"), ("server.properties","AutoLoot"),
 ("server.properties","DeleteCharAfterDays"), ("server.properties","Hostname"),
 ("players.properties","EnchantChanceNonMagicWeapon"),
 ("players.properties","EnchantChanceMagicWeapon"),
 ("players.properties","EnchantChanceArmor"),
 ("players.properties","EnchantSafeMax"),
 ("players.properties","EnchantMaxWeapon"),
 ("players.properties","MaxBuffsAmount"),
 ("players.properties","OfflineTradeEnable"),
 ("players.properties","AutoLearnSkills"),
 ("players.properties","SubClassWithoutQuests"),
 ("players.properties","DeathPenaltyChance"),
 ("npcs.properties","FreeTeleport"),
 ("npcs.properties","SpawnMultiplier"),
 ("npcs.properties","AllowEntireTree"),
 ("events.properties","OlyStartTime"),
 ("siege.properties","SiegeLength"),
 ("loginserver.properties","AutoCreateAccounts"),
}

# ------------------------------------------------------- dead-key check ----
java_src = ""
for root, dirs, files in os.walk(os.path.join(ROOT, "java")):
    for fn in files:
        if fn.endswith(".java"):
            with open(os.path.join(root, fn), errors="ignore") as f:
                java_src += f.read()

def is_read(fname, key):
    if re.search(r'"' + re.escape(key) + r'"', java_src):
        return True
    if fname == "logging.properties":
        return True  # consumed by java.util.logging via LogManager.readConfiguration
    if fname == "geoengine.properties" and re.match(r"^\d+_\d+$", key):
        return True  # region directives read by GeoEngine via containsKey
    return False

# ------------------------------------------------------- logging labels ----
def logging_labels(key):
    """Generate (label_en, label_es) for java.util.logging keys."""
    subjects = [
        ("net.sf.l2j.commons.logging.handler.ErrorLogHandler", "Error log", "Registro de errores"),
        ("net.sf.l2j.commons.logging.handler.ChatLogHandler", "Chat log", "Registro de chat"),
        ("net.sf.l2j.commons.logging.handler.GMAuditLogHandler", "GM audit log", "Registro de auditoría de GM"),
        ("net.sf.l2j.commons.logging.handler.ItemLogHandler", "Item log", "Registro de objetos"),
        ("java.util.logging.ConsoleHandler", "Console", "Consola"),
        ("java.util.logging.FileHandler", "Console file log", "Archivo de registro de consola"),
        ("net.sf.l2j.gameserver", "Gameserver logger", "Logger del gameserver"),
        ("net.sf.l2j.loginserver", "Loginserver logger", "Logger del loginserver"),
    ]
    suffixes = [
        ("pattern", "file pattern", "patrón de archivo"),
        ("limit", "max file size (bytes)", "tamaño máx. de archivo (bytes)"),
        ("count", "rotation file count", "cantidad de archivos de rotación"),
        ("formatter", "formatter class", "clase formateadora"),
        ("filter", "filter class", "clase de filtro"),
        ("append", "append mode", "modo append"),
        ("level", "log level", "nivel de log"),
        ("handlers", "handlers", "manejadores"),
        ("useParentHandlers", "use parent handlers", "usar manejadores padre"),
    ]
    if key == "handlers":
        return ("Global log handlers", "Manejadores globales de log")
    if key == ".level":
        return ("Global default log level", "Nivel de log global por defecto")
    for subj, en_s, es_s in subjects:
        if key.startswith(subj):
            rest = key[len(subj):].lstrip(".")
            for suf, en_x, es_x in suffixes:
                if rest == suf:
                    return (f"{en_s} {en_x}", f"{es_s}: {es_x}")
            return (f"{en_s} {rest}", f"{es_s}: {rest}")
    for suf, en_x, es_x in suffixes:
        if key.endswith(suf):
            prefix = key.split(".")[0]
            return (f"{prefix} {en_x}", f"{prefix}: {es_x}")
    return (key, key)

# ------------------------------------------------------------------ build ---
catalog = []
missing_labels = []
dead_found = []
per_file = {}

for fname in sorted(os.listdir(CFG)):
    if not fname.endswith(".properties"):
        continue
    entries = parse_properties(os.path.join(CFG, fname))
    per_file[fname] = 0
    for key, val, desc in entries:
        is_region = fname == "geoengine.properties" and re.match(r"^\d+_\d+$", key)
        dead = not is_read(fname, key)
        if dead:
            dead_found.append((fname, key))
        if is_region:
            cat = "geoengine-regions"
            en = f"Load geodata region {key}"
            es = f"Cargar región de geodata {key}"
            typ = "bool"
            if not desc:
                desc = ("Presence of this line enables loading of the geodata region "
                        f"{key}; comment it out to skip the region (everything-allowed mode).")
        elif fname == "logging.properties":
            cat = "logging"
            en, es = logging_labels(key)
            typ = "string" if infer_type(val) == "string" else infer_type(val)
            if not desc:
                desc = "Consumed by java.util.logging (LogManager.readConfiguration), not by Config.java."
        else:
            meta = L.get((fname, key))
            if meta is None:
                missing_labels.append((fname, key))
                cat, en, es = "misc", key, key
            else:
                cat, en, es = meta
            typ = infer_type(val)
        catalog.append({
            "file": fname,
            "key": key,
            "value": val,
            "type": typ,
            "category": cat,
            "label_en": en,
            "label_es": es,
            "description": desc,
            "dead": dead,
            "priority": (fname, key) in PRIORITY,
        })
        per_file[fname] += 1

if missing_labels:
    print("MISSING LABELS:", missing_labels)
    sys.exit(1)

# sanity: every PRIORITY key must exist
have = {(e["file"], e["key"]) for e in catalog}
for p in PRIORITY:
    if p not in have:
        print("PRIORITY key not found:", p)
        sys.exit(1)

with open(OUT, "w") as f:
    json.dump(catalog, f, indent=2, ensure_ascii=False)

print(f"Wrote {OUT}: {len(catalog)} entries")
for fn, n in sorted(per_file.items()):
    print(f"  {fn}: {n}")
print("dead keys:", dead_found if dead_found else "none")
print("priority keys:", sum(1 for e in catalog if e["priority"]))
