# Guía del Jugador — L2Vzla (Lineage 2 Interlude)

¡Bienvenido! Esta guía te explica paso a paso cómo conectarte al servidor. No necesitas saber nada técnico: sigue los pasos en orden y estarás jugando en pocos minutos.

---

## Filosofía del servidor

Antes de empezar, que quede claro cómo jugamos aquí:

- **La automatización es legal y para todos.** Recuerdas lo que hacía L2Walker: loot automático, buffs cómodos, tiendas offline. Aquí todo eso está integrado en el servidor y disponible para **cada jugador por igual**, sin pagar nada. Nadie necesita programas externos ni arriesga su cuenta.
- **No hay pay-to-win.** No se vende equipo, no hay ventajas para donadores. La única forma de progresar es jugando.
- **Sin bloqueos anti-bot.** No perseguimos a los clientes de automatización; las ventajas de QoL que daban esos programas ya son parte del servidor (autoloot, más slots de buffs, tiendas offline, comandos de voz de utilidad).

En resumen: aquí todos juegan con las mismas herramientas. Gana el que juega mejor, no el que paga más.

---

## 1. Consigue un cliente limpio de Lineage 2 Interlude (C6)

Necesitas el cliente oficial de **Lineage 2 Interlude** (también llamado **C6**). Cualquier cliente limpio de Interlude sirve.

- Descarga el cliente desde: `<URL_DEL_CLIENTE>`
- Instálalo en tu PC. Al terminar, tendrás una carpeta llamada `Lineage II` (o similar).

> **Importante:** usa un cliente **limpio** (sin parches de otros servidores). Si ya tienes un cliente de otro servidor, es mejor instalar uno nuevo para evitar problemas.

## 2. Descarga el parche del servidor

El administrador distribuye una **carpeta system parcheada** lista para conectar. Es la forma más fácil:

1. Descarga el parche desde: `<URL_DEL_PARCHE>`
2. Descomprime el archivo.
3. Copia la carpeta `system` que viene en el parche dentro de tu carpeta del juego (`Lineage II`), reemplazando la `system` original.
4. Abre el juego con `l2.exe` (está dentro de la carpeta `system`).

¡Listo! Con el parche no necesitas tocar nada más. Si prefieres hacerlo a mano, sigue leyendo.

## 3. Método manual: editar `l2.ini`

Si no usas el parche, puedes apuntar tu cliente al servidor editando un archivo:

1. Ve a la carpeta del juego y entra a la carpeta `system`.
2. Abre el archivo `l2.ini` con el Bloc de notas (click derecho → Abrir con → Bloc de notas).
3. Busca la línea que empieza con `ServerAddr=` y cámbiala a:

   ```
   ServerAddr=<IP_O_DOMINIO_DEL_SERVIDOR>
   ```

4. Guarda el archivo y cierra.
5. Abre el juego con `l2.exe`.

> **Nota:** algunos clientes vienen con el `l2.ini` cifrado (no se puede leer al abrirlo). En ese caso, usa el parche del paso 2, que ya trae un `l2.ini` correcto y legible.

## 4. Alternativa: archivo hosts de Windows

Si el servidor usa un **dominio** (por ejemplo `l2authd.lineage2.com` apuntando al servidor), otra forma de conectar es con el archivo `hosts`:

1. Abre el Bloc de notas **como administrador**: menú Inicio → escribe "bloc de notas" → click derecho → "Ejecutar como administrador".
2. En el Bloc de notas, ve a Archivo → Abrir y navega a:

   ```
   C:\Windows\System32\drivers\etc\hosts
   ```

   (En la ventana de abrir, cambia el filtro de "Documentos de texto" a **"Todos los archivos"** para poder ver el archivo `hosts`.)

3. Agrega esta línea al final del archivo:

   ```
   <IP_O_DOMINIO_DEL_SERVIDOR> l2authd.lineage2.com
   ```

4. Guarda el archivo (Ctrl+S) y cierra.
5. Abre el juego con `l2.exe`.

Este método es útil si tu `l2.ini` está cifrado y no tienes el parche a la mano.

## 5. Crear tu cuenta

**No hay página de registro ni formulario.** Las cuentas se crean automáticamente la primera vez que inicias sesión:

1. Abre el juego.
2. Escribe el usuario y la contraseña que quieras usar.
3. Entra. El servidor crea tu cuenta en ese momento.

**Anota tu usuario y contraseña en un lugar seguro** — son los que usarás siempre. No compartas tu contraseña con nadie, ni siquiera con alguien que diga ser del staff.

## 6. Configuración recomendada para PCs modestas y conexiones venezolanas

Si tu PC no es muy potente o tu internet es limitado, ajusta estas opciones dentro del juego (menú **Opciones → Video / Audio**):

**Video:**
- Resolución: usa la nativa de tu monitor, o 1024×768 si va lento.
- Modo ventana: **activado** si quieres tener el juego junto a otras ventanas (el juego consume menos en ventana pequeña).
- **Distancia de visión:** baja (2 o 3). Es la opción que más afecta el rendimiento.
- **Sombras:** desactivadas.
- **Reflejos:** desactivados.
- **Efectos de hechizos / partículas:** bajos o mínimos.
- **Animaciones de personajes (clipping):** en "bajo" — reduce el trabajo de la tarjeta de video cuando hay mucha gente.
- **Minimizar uso de recursos en segundo plano:** activado (el juego casi no consume CPU cuando está minimizado — ideal para dejar tiendas o farmear mientras haces otra cosa).

**Audio:**
- Si tu PC es muy limitada, baja los canales de sonido o desactiva la música.

**Para tu conexión:**
- Lineage 2 consume muy poco ancho de banda (unos pocos KB/s); funciona bien incluso con internet lento o datos móviles compartidos.
- Lo que más importa es la **estabilidad**: si tu conexión se cae seguido, evita jugar por Wi-Fi lejos del router; un cable o estar cerca del router ayuda mucho.
- Cierra descargas, streaming (YouTube/Netflix) y videollamadas mientras juegas para reducir el lag.
- El servidor permite **tiendas offline**: puedes dejar tu personaje vendiendo o comprando con la PC apagada. Así ahorras luz e internet — úsalo.

**Pantalla completa:**
- Si el juego se ve estirado o con bordes negros, cambia la resolución dentro del juego a la misma que usa tu Windows.

## 7. Problemas comunes

| Problema | Solución |
|---|---|
| El juego no abre o da error de "protocolo" | No estás usando la carpeta `system` correcta. Instala el parche del paso 2. |
| Se queda en la pantalla de login | Revisa que `ServerAddr=` tenga la dirección correcta, o que el paso del archivo `hosts` esté bien hecho. |
| "Cuenta no existe" | Las cuentas se crean solas al primer login. Revisa que no tengas errores de tipeo en el usuario. |
| Mucho lag / desconexiones | Revisa la sección 6. Si persiste, avisa al staff por `<CANAL_DE_SOPORTE>`. |
| Critical Error al abrir | Borra la carpeta `system`, vuelve a poner la del parche, e intenta de nuevo. |

---

¿Dudas? Escríbenos por `<CANAL_DE_SOPORTE>`. ¡Nos vemos en Aden!
