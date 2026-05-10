# Aspen Spas — Warehouse Manager

Single-file HTML/JS app que maneja el inventario de spas de Aspen: factory production, dispatch, deliveries, materiales y fotos. Datos sincronizados a Firebase Realtime Database con login Google + reglas estrictas.

**Stack:** Vanilla JS · Firebase Realtime DB + Storage + Auth · Three.js para vista 3D · pdf.js para parser de BOLs · Leaflet para GPS · Lazy-loaded QR scanner.

**Live:** [aspenservices.github.io/aspen-warehouse](https://aspenservices.github.io/aspen-warehouse)

---

## Cómo se usa

| Rol | Password | Qué ve |
|---|---|---|
| 🔑 **Admin** | (vos elegís) | Todo |
| 🏭 **Warehouse Manager** | `0000` | Floor Map · Schedule · Incoming · Loading Bay · Dispatch · Materiales · Requests |
| 🚚 **Factory** | `0000` | Factory Warehouse · Marriages · In Transit · Receiving |
| 🚛 **Truck / Transit** | `0000` | **Loading Bay** (escanear QR para cargar) · In Transit |
| 📅 **Dispatch Organizer** | `0000` | Schedule · Dispatch · Map · In Transit |

Los passwords cambian en `Settings → Authorizations`. Cada rol tiene el suyo.

### Flujo típico

1. **Factory** construye un spa → lo crea en Factory Warehouse → click `📦 Ship to WH`
2. **Truck/Transit** entra al Loading Bay (en su tablet) → escanea el QR del spa → spa pasa a *in-transit*
3. **Warehouse Manager** ve el spa coming en *In Transit* → cuando llega, escanea → asigna posición en Floor Map
4. **Dispatch Organizer** programa entrega → sube BOL PDF → sistema auto-detecta spa, cover, accesorios
5. Al día del pickup, dealer firma → spa sale del warehouse → log en Dispatch Log

---

## Setup paso a paso

### 1. Crear el repo en GitHub

1. Ir a [github.com/aspenservices](https://github.com/aspenservices) → click **New repository**
2. Nombre: `aspen-warehouse`
3. Description: `Warehouse manager for Aspen Spas operations`
4. Privacy: **Private** (datos de operación)
5. Marcar ☑ **Add a README file**
6. Click **Create repository**

### 2. Subir los archivos

En el repo recién creado, click **Add file → Upload files** y arrastrá:

```
aspen-warehouse/
  ├── index.html              ← la app (este archivo)
  ├── README.md               ← este archivo
  ├── database.rules.json     ← reglas de Firebase Realtime DB
  ├── storage.rules           ← reglas de Firebase Storage
  └── .gitignore              ← qué no subir
```

Commit message: `Initial commit — v3.32`

### 3. Activar GitHub Pages

1. En el repo → **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` · folder: `/ (root)`
4. **Save** → esperá ~1 min y la app está en `https://aspenservices.github.io/aspen-warehouse`

### 4. Crear el proyecto Firebase

1. Ir a [console.firebase.google.com](https://console.firebase.google.com) → **Add project**
2. Nombre: `aspen-warehouse`
3. **Disable Google Analytics** (no hace falta) → Create
4. Esperar que se cree (~30s)

### 5. Activar Realtime Database

1. Sidebar izquierdo → **Build → Realtime Database**
2. Click **Create Database**
3. Region: `us-central1` (la más cerca de St. Louis)
4. Reglas: empezar en **locked mode** (vamos a poner reglas custom)
5. Click **Enable**

### 6. Activar Storage

1. Sidebar → **Build → Storage**
2. Click **Get started**
3. Empezar en **production mode** (locked)
4. Region: misma que el DB → **Done**

### 7. Activar Authentication con Google

1. Sidebar → **Build → Authentication**
2. Click **Get started**
3. Tab **Sign-in method** → click en **Google** → toggle **Enable**
4. Support email: `serviceaspen096@gmail.com` (o el tuyo)
5. **Save**

### 8. Subir las reglas de seguridad

#### Realtime Database rules

1. **Realtime Database → Rules** tab
2. Borrar todo y pegar el contenido de `database.rules.json`
3. **IMPORTANTE**: editar la lista de emails autorizados al inicio del archivo
4. **Publish**

#### Storage rules

1. **Storage → Rules** tab
2. Pegar el contenido de `storage.rules`
3. **Publish**

### 9. Conectar la app a Firebase

1. En Firebase Console: **Project settings (engranaje arriba) → General → Your apps**
2. Click el ícono `</>` (Web app)
3. Nickname: `aspen-warehouse`
4. **NO** marcar Firebase Hosting
5. **Register app** → vas a ver un objeto `firebaseConfig`
6. Copialo entero (apiKey, authDomain, etc.)
7. Abrir `index.html` → buscar `FIREBASE_CONFIG = {` (al inicio del `<script>`)
8. Pegar el objeto entre las llaves
9. Guardar
10. Subir el index.html actualizado a GitHub (Edit → paste → commit)

### 10. Agregar dominios autorizados

1. Firebase Console → **Authentication → Settings → Authorized domains**
2. Agregar `aspenservices.github.io`
3. (Opcional para dev local) agregar `localhost`

---

## Acceso por whitelist

En `database.rules.json` hay una lista de emails autorizados:

```json
{
  "rules": {
    ".read":  "auth != null && root.child('authorized').child(auth.token.email.replace('.', ',').replace('@', '_at_')).exists()",
    ".write": "auth != null && root.child('authorized').child(auth.token.email.replace('.', ',').replace('@', '_at_')).exists()"
  }
}
```

Para agregar un usuario:

1. Realtime DB → Data tab
2. Click el `+` al lado del root
3. Crear nodo: `authorized`
4. Adentro de `authorized`, crear keys con el email transformado:
   - `tom_at_aspenspas,com` → value `{"role": "admin"}`
   - `sam_at_aspenspas,com` → value `{"role": "admin"}`
   - `alberto_at_aspenspas,com` → value `{"role": "admin"}`
   - `nela_at_aspenspas,com` → value `{"role": "warehouse"}`
   - `jeremy_at_aspenspas,com` → value `{"role": "transit"}`
   - etc.

(El reemplazo de `.` → `,` y `@` → `_at_` es porque Firebase no acepta esos caracteres en keys.)

---

## Photos · cómo funciona

Cualquier item del sistema (spa en factory, item en incoming, material recibido, dispatch, daño en transit) puede tener fotos asociadas:

- En la card del item, click **📷 Add photo**
- La foto se sube a Firebase Storage en `aspen-warehouse/{tipo}/{id}/{timestamp}.jpg`
- La URL se guarda en el array `photos` del item
- Las fotos se ven inline en la card

**Storage path por tipo:**

```
aspen-warehouse/
  ├── factory-spas/{spaId}/         ← spas en factory
  ├── incoming/{itemId}/             ← items que llegan al warehouse  
  ├── materials/{matId}/             ← supplies/materiales
  ├── damages/{itemId}/              ← daños en transit
  └── dispatch/{groupId}/            ← BOLs y prueba de pickup
```

Las reglas de `storage.rules` solo permiten que usuarios autenticados (en la whitelist) lean/escriban.

---

## Cloud sync

La app guarda todo en `localStorage` como antes (rápido, funciona offline). Cada **2 minutos** mientras está abierta + cada vez que pulsás `Ctrl+S`, sube un snapshot a Firebase en `aspen-warehouse/state/{deviceId}/`.

**Ventajas:**
- Si tu computadora se rompe, abrís la app en otra → click `Restore from cloud` → todo vuelve
- Otros usuarios autorizados pueden ver el último snapshot guardado
- Histórico de los últimos 30 snapshots por dispositivo

**Desventajas (importante saber):**
- NO es realtime sync — si dos personas editan a la vez, gana el último que sube
- Es backup, no colaboración simultánea

Para colaboración real-time (varios usuarios escribiendo a la vez sin pisarse), habría que migrar a Firestore con listeners — eso queda para una versión futura.

---

## Estructura de datos en Firebase

```
aspen-warehouse/
├── authorized/                      ← whitelist de emails
│   ├── alberto_at_aspenspas,com: { role: "admin" }
│   └── ...
├── state/                           ← snapshots por dispositivo
│   ├── {deviceId-1}/
│   │   ├── snapshots/
│   │   │   ├── {timestamp-1}: { units, factory, incoming, ... }
│   │   │   └── ...
│   │   └── latest: { ... }          ← último snapshot
│   └── ...
└── photos-index/                    ← índice rápido de fotos
    └── {photoId}: { url, type, itemId, uploadedBy, timestamp }
```

---

## Versionado

| Versión | Fecha | Cambios principales |
|---|---|---|
| v3.32 | May 10, 2026 | Truck/Transit en dropdown · Firebase auth + photos |
| v3.31 | May 10, 2026 | BOL parser detecta panels, lifters, steps + valida pieces |
| v3.30 | May 10, 2026 | Loading Bay vista propia + responsive audit |
| v3.29 | May 10, 2026 | Bug fix: ship-to-WH no remueve de factory hasta truck scan |
| v3.28 | May 9, 2026 | Reject flow · factory-receive mode |
| v3.27 | May 9, 2026 | In Transit en sidebar · admin-only modify |

---

## Troubleshooting

**"Permission denied" al cargar datos**
→ Tu email no está en `authorized/` en Realtime DB. Pedile a Alberto que te agregue.

**El botón "Sign in with Google" no hace nada**
→ Probablemente faltó configurar el dominio autorizado en Firebase Auth → Settings → Authorized domains.

**Las fotos no se suben**
→ Verificar que Storage esté activado y las rules publicadas. Mirar Console del browser (F12) por errores tipo `storage/unauthorized`.

**"Quota exceeded"**
→ El plan gratis de Firebase (Spark) tiene límites. Si los superás, upgrade a plan Blaze (pay-as-you-go) — para este caso de uso cuesta centavos al mes.

---

## Soporte

Cualquier problema → preguntale a Claude (chat) con el screenshot del error.

Repo: [github.com/aspenservices/aspen-warehouse](https://github.com/aspenservices/aspen-warehouse)
